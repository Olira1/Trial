import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
  type DBTransaction,
} from '../../database/database.module';
import {
  DISPATCH_METRICS,
  NOOP_DISPATCH_METRICS,
  type DispatchMetrics,
} from '../dispatch-candidate';
import {
  MatchWorkerService,
  OfferCancellationService,
} from '../dispatch-offer';
import type {
  DispatchCancellationActorRole,
  DispatchCancellationInput,
  DispatchCancellationReasonCode,
} from '../dispatch-offer/dispatch-cancellation.types';
import {
  dispatchAssignment,
  dispatchCancellation,
  dispatchOffer,
} from '../dispatch-offer/schema';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest, type NewRideRequest, type RideRequest } from './schema';

export type CreateRideRequestInput = {
  riderId: string;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  fareEstimateId: string;
  idempotencyKey: string;
};

export type CancelRideRequestInput = DispatchCancellationInput;

type NormalizedCancellation = {
  actorRole: DispatchCancellationActorRole;
  reasonCode: DispatchCancellationReasonCode;
  notes: string | null;
};

type AssignmentForRiderCancellation = {
  id: string;
  requestId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  offerState: typeof dispatchOffer.$inferSelect.state;
};

const ROUND = (n: number) => Math.round(n * 1e6);
const INITIAL_MATCH_ATTEMPT_ID = 'initial';

type FareEstimateForRequest = {
  id: string;
  riderId: string;
  pickupLon: number;
  pickupLat: number;
  destinationLon: number;
  destinationLat: number;
  vehicleType: 'standard';
  currency: 'ETB';
  distanceMeters: number;
  durationSeconds: number;
  rateMinorPerKm: number;
  estimatedFareMinor: number;
  expiresAt: Date;
};

type FareEstimateRow = Omit<FareEstimateForRequest, 'expiresAt'> & {
  expiresAt: Date | string;
};

type RideRequestRouteRow = {
  pickup_lon: number;
  pickup_lat: number;
  destination_lon: number;
  destination_lat: number;
};

type CreateRideRequestResult = {
  snapshot: RideRequestSnapshot;
  enqueueInitialMatch: boolean;
  enqueueReason: 'created' | 'idempotent_replay';
};

export type RideRequestAssignment = {
  id: string;
  offerId: string;
  requestId: string;
  riderId: string;
  driverId: string;
  state: 'assigned';
  assignedAt: Date;
  driver: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
  };
  vehicle: {
    make: string;
    model: string;
    color: string;
    plateRegion: 'aa' | 'or' | 'ah' | 'dr' | 'tg';
    plateCode: '01' | '02' | '03';
    plateCodeSubtype: 'transport_service' | 'other' | null;
    plateNumber: string;
  };
  trip: {
    id: string;
    state: 'started' | 'completed';
    startedAt: Date;
    completedAt: Date | null;
  } | null;
  pickup: {
    id: string;
    state: 'arrived' | 'warning_sent' | 'rider_no_show_cancelled';
    arrivedAt: Date;
    warningDueAt: Date;
    warningSentAt: Date | null;
    noShowCancellableAt: Date;
    noShowCancelledAt: Date | null;
  } | null;
};

export type RideRequestCancellation = {
  id: string;
  requestId: string;
  offerId: string | null;
  assignmentId: string | null;
  actorUserId: string;
  actorRole: DispatchCancellationActorRole;
  reasonCode: DispatchCancellationReasonCode;
  notes: string | null;
  createdAt: Date;
};

export type RideRequestSnapshot = RideRequest & {
  assignment: RideRequestAssignment | null;
  cancellation: RideRequestCancellation | null;
};

export type RideRequestHistoryInput = {
  limit: number;
  offset: number;
};

export type RideRequestHistoryResult = {
  items: RideRequestSnapshot[];
  total: number;
  limit: number;
  offset: number;
};

type RideRequestAssignmentRow = {
  id: string;
  offer_id: string;
  request_id: string;
  rider_id: string;
  driver_id: string;
  assigned_at: Date | string;
  driver_full_name: string;
  driver_phone: string;
  driver_rating: number;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_plate_region: 'aa' | 'or' | 'ah' | 'dr' | 'tg';
  vehicle_plate_code: '01' | '02' | '03';
  vehicle_plate_code_subtype: 'transport_service' | 'other' | null;
  vehicle_plate_number: string;
  trip_id: string | null;
  trip_state: 'started' | 'completed' | null;
  trip_started_at: Date | string | null;
  trip_completed_at: Date | string | null;
  pickup_id: string | null;
  pickup_state: 'arrived' | 'warning_sent' | 'rider_no_show_cancelled' | null;
  pickup_arrived_at: Date | string | null;
  pickup_warning_due_at: Date | string | null;
  pickup_warning_sent_at: Date | string | null;
  pickup_no_show_cancellable_at: Date | string | null;
  pickup_no_show_cancelled_at: Date | string | null;
};

@Injectable()
export class RideRequestsService {
  private readonly logger = new Logger(RideRequestsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly outbox: DispatchOutboxService,
    private readonly offerCancellation: OfferCancellationService,
    private readonly matchWorker: MatchWorkerService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async findByIdForRider(
    riderId: string,
    requestId: string,
  ): Promise<RideRequestSnapshot> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(rideRequest)
        .where(
          and(eq(rideRequest.id, requestId), eq(rideRequest.riderId, riderId)),
        )
        .limit(1);

      if (!request) throw new NotFoundException('ride request not found');
      return this.withStoredRoute(request, tx);
    });
  }

  async findCurrentForRider(
    riderId: string,
  ): Promise<RideRequestSnapshot | null> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(rideRequest)
        .where(
          and(
            eq(rideRequest.riderId, riderId),
            sql`${rideRequest.state} IN ('searching', 'offered', 'assigned')`,
          ),
        )
        .orderBy(
          sql`CASE WHEN ${rideRequest.state} IN ('searching', 'offered') THEN 0 ELSE 1 END`,
          desc(rideRequest.createdAt),
        )
        .limit(1);

      return request ? this.withStoredRoute(request, tx) : null;
    });
  }

  async findHistoryForRider(
    riderId: string,
    input: RideRequestHistoryInput,
  ): Promise<RideRequestHistoryResult> {
    return this.db.transaction(async (tx) => {
      const historyWhere = and(
        eq(rideRequest.riderId, riderId),
        sql`${rideRequest.state} IN ('completed', 'cancelled', 'expired', 'no_driver_found', 'system_failed')`,
      );

      const [countRow] = await tx
        .select({ total: count() })
        .from(rideRequest)
        .where(historyWhere);

      const requests = await tx
        .select()
        .from(rideRequest)
        .where(historyWhere)
        .orderBy(
          desc(rideRequest.updatedAt),
          desc(rideRequest.createdAt),
          desc(rideRequest.id),
        )
        .limit(input.limit)
        .offset(input.offset);

      const items: RideRequestSnapshot[] = [];
      for (const request of requests) {
        items.push(await this.withStoredRoute(request, tx));
      }

      return {
        items,
        total: Number(countRow?.total ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    });
  }

  async create(input: CreateRideRequestInput): Promise<RideRequestSnapshot> {
    if (!this.config.enableNewRequests) {
      throw new ConflictException('instant ride request creation is disabled');
    }
    if (
      this.config.internalRiderAllowlist.length > 0 &&
      !this.config.internalRiderAllowlist.includes(input.riderId)
    ) {
      throw new ConflictException(
        'instant ride request creation is not enabled for this rider',
      );
    }
    if (!this.isPickupWithinRolloutBounds(input.pickup)) {
      throw new ConflictException(
        'instant ride request creation is not enabled for this pickup area',
      );
    }
    if (!this.isWithinRolloutHours(new Date())) {
      throw new ConflictException(
        'instant ride request creation is not enabled at this time',
      );
    }

    const result = await this.db.transaction<CreateRideRequestResult>(
      async (tx) => {
        const existing = await this.findExistingForIdempotency(
          input.riderId,
          input.idempotencyKey,
          tx,
        );
        if (existing) {
          await this.assertPayloadMatch(existing.id, input, tx);
          const snapshot = this.withInputRoute(
            existing,
            input,
            await this.findAssignmentForRequest(existing.id, tx),
          );
          return {
            snapshot,
            enqueueInitialMatch: existing.state === 'searching',
            enqueueReason: 'idempotent_replay',
          };
        }

        const active = await this.findActiveForRider(input.riderId, tx);
        if (active) {
          throw new ConflictException(
            'rider already has an active ride request',
          );
        }

        const estimate = await this.findFareEstimateForRequest(input, tx);
        const reused = await this.findRequestForFareEstimate(estimate.id, tx);
        if (reused) {
          throw new ConflictException('fare estimate is already bound');
        }

        const now = new Date();
        if (estimate.expiresAt.getTime() <= now.getTime()) {
          throw new ConflictException('fare estimate has expired');
        }
        this.assertFareEstimatePayloadMatch(input, estimate);

        const matchingDeadlineAt = new Date(
          now.getTime() + this.config.matchingDeadlineSeconds * 1_000,
        );

        const values: NewRideRequest = {
          riderId: input.riderId,
          pickup: input.pickup,
          destination: input.destination,
          fareEstimateId: estimate.id,
          vehicleType: estimate.vehicleType,
          rideType: 'instant',
          currency: estimate.currency,
          distanceMeters: estimate.distanceMeters,
          durationSeconds: estimate.durationSeconds,
          rateMinorPerKm: estimate.rateMinorPerKm,
          estimatedFareMinor: estimate.estimatedFareMinor,
          idempotencyKey: input.idempotencyKey,
          offerTtlSeconds: this.config.offerTtlSeconds,
          matchingDeadlineSeconds: this.config.matchingDeadlineSeconds,
          matchingDeadlineAt,
        };

        const [created] = await tx
          .insert(rideRequest)
          .values(values)
          .returning();

        if (!created) {
          throw new Error('ride request insert returned no row');
        }

        this.metrics.recordRequestCreated(created.id, input.riderId);

        await this.outbox.append(tx, {
          eventKey: `ride_request:${created.id}:created`,
          eventType: 'ride_request.created.v1',
          aggregateType: 'ride_request',
          aggregateId: created.id,
          correlationId: randomUUID(),
          actorUserId: input.riderId,
          payload: {
            requestId: created.id,
            riderId: input.riderId,
            state: 'searching',
            pickupLatitude: input.pickup.latitude,
            pickupLongitude: input.pickup.longitude,
            destinationLatitude: input.destination.latitude,
            destinationLongitude: input.destination.longitude,
            fareEstimateId: estimate.id,
            vehicleType: estimate.vehicleType,
            rideType: 'instant',
            currency: estimate.currency,
            distanceMeters: estimate.distanceMeters,
            durationSeconds: estimate.durationSeconds,
            rateMinorPerKm: estimate.rateMinorPerKm,
            estimatedFareMinor: estimate.estimatedFareMinor,
            idempotencyKey: input.idempotencyKey,
            offerTtlSeconds: this.config.offerTtlSeconds,
            matchingDeadlineSeconds: this.config.matchingDeadlineSeconds,
            matchingDeadlineAt: matchingDeadlineAt.toISOString(),
          },
        });

        return {
          snapshot: this.withInputRoute(created, input, null),
          enqueueInitialMatch: true,
          enqueueReason: 'created',
        };
      },
    );

    this.logger.log(
      `Ride request committed requestId=${result.snapshot.id} riderId=${input.riderId} state=${result.snapshot.state} enqueueInitialMatch=${result.enqueueInitialMatch} reason=${result.enqueueReason}`,
    );

    if (result.enqueueInitialMatch) {
      await this.enqueueInitialMatchJob(result.snapshot.id, input.riderId);
    }

    return result.snapshot;
  }

  private async enqueueInitialMatchJob(
    requestId: string,
    riderId: string,
  ): Promise<void> {
    this.logger.log(
      `Initial match enqueue requested requestId=${requestId} riderId=${riderId} attemptId=${INITIAL_MATCH_ATTEMPT_ID}`,
    );

    try {
      const job = await this.matchWorker.enqueueMatchJob(
        requestId,
        INITIAL_MATCH_ATTEMPT_ID,
      );
      this.logger.log(
        `Initial match job enqueued requestId=${requestId} riderId=${riderId} attemptId=${INITIAL_MATCH_ATTEMPT_ID} jobId=${job.id ?? 'unknown'} jobName=${job.name}`,
      );
    } catch (error) {
      this.logger.error(
        `Initial match job enqueue failed requestId=${requestId} riderId=${riderId} attemptId=${INITIAL_MATCH_ATTEMPT_ID}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async cancel(
    riderId: string,
    requestId: string,
    input: CancelRideRequestInput = {},
  ): Promise<RideRequestSnapshot> {
    const cancellation = this.normalizeRiderCancellation(input);

    return this.db.transaction(async (tx) => {
      const [unlockedRequest] = await tx
        .select()
        .from(rideRequest)
        .where(eq(rideRequest.id, requestId))
        .limit(1);

      if (!unlockedRequest || unlockedRequest.riderId !== riderId) {
        throw new NotFoundException('ride request not found');
      }

      if (unlockedRequest.state === 'cancelled') {
        return this.withStoredRoute(unlockedRequest, tx);
      }

      if (
        !['searching', 'offered', 'assigned'].includes(unlockedRequest.state)
      ) {
        throw new ConflictException(
          `cannot cancel request in state ${unlockedRequest.state}`,
        );
      }

      let cancelledPendingOfferId: string | null = null;
      if (unlockedRequest.state === 'offered') {
        const cancelledOffer =
          await this.offerCancellation.cancelPendingOfferForRequest(
            tx,
            requestId,
          );
        cancelledPendingOfferId = cancelledOffer?.id ?? null;
      }

      const [request] = await tx
        .select()
        .from(rideRequest)
        .where(eq(rideRequest.id, requestId))
        .limit(1)
        .for('update');

      if (!request || request.riderId !== riderId) {
        throw new NotFoundException('ride request not found');
      }

      if (request.state === 'cancelled') {
        return this.withStoredRoute(request, tx);
      }

      if (request.state === 'assigned') {
        return this.cancelAssignedRequestForRider(
          tx,
          riderId,
          request,
          cancellation,
        );
      }

      if (!['searching', 'offered'].includes(request.state)) {
        throw new ConflictException(
          `cannot cancel request in state ${request.state}`,
        );
      }

      const [updated] = await tx
        .update(rideRequest)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(eq(rideRequest.id, requestId))
        .returning();

      if (!updated) {
        throw new Error('ride request cancel update returned no row');
      }

      const persistedCancellation = await this.recordCancellation(
        tx,
        {
          requestId: updated.id,
          offerId: cancelledPendingOfferId,
          assignmentId: null,
          actorUserId: riderId,
        },
        cancellation,
      );

      this.metrics.recordRequestCancelled(updated.id, 'rider');

      await this.outbox.append(tx, {
        eventKey: `ride_request:${updated.id}:cancelled`,
        eventType: 'ride_request.cancelled.v1',
        aggregateType: 'ride_request',
        aggregateId: updated.id,
        correlationId: randomUUID(),
        actorUserId: riderId,
        payload: {
          requestId: updated.id,
          riderId,
          state: 'cancelled',
          cancellation: {
            id: persistedCancellation.id,
            ...cancellation,
          },
        },
      });

      return this.withStoredRoute(updated, tx);
    });
  }

  private normalizeRiderCancellation(
    input: CancelRideRequestInput,
  ): NormalizedCancellation {
    const notes = input.notes?.trim();

    return {
      actorRole: 'rider',
      reasonCode: input.reasonCode ?? 'generic',
      notes: notes && notes.length > 0 ? notes : null,
    };
  }

  private async recordCancellation(
    tx: DBTransaction,
    target: {
      requestId: string;
      offerId: string | null;
      assignmentId: string | null;
      actorUserId: string;
    },
    cancellation: NormalizedCancellation,
  ) {
    const [created] = await tx
      .insert(dispatchCancellation)
      .values({
        requestId: target.requestId,
        offerId: target.offerId,
        assignmentId: target.assignmentId,
        actorUserId: target.actorUserId,
        actorRole: cancellation.actorRole,
        reasonCode: cancellation.reasonCode,
        notes: cancellation.notes,
      })
      .onConflictDoNothing({
        target: dispatchCancellation.requestId,
      })
      .returning();

    if (created) {
      return created;
    }

    const [existing] = await tx
      .select()
      .from(dispatchCancellation)
      .where(eq(dispatchCancellation.requestId, target.requestId))
      .limit(1)
      .for('update');

    if (!existing) {
      throw new ConflictException('request cancellation lost a race');
    }

    return existing;
  }

  private async cancelAssignedRequestForRider(
    tx: DBTransaction,
    riderId: string,
    request: RideRequest,
    cancellation: NormalizedCancellation,
  ): Promise<RideRequestSnapshot> {
    const assignment = await this.findAssignmentForRiderCancellation(
      tx,
      riderId,
      request.id,
    );

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, assignment.driverId))
      .limit(1)
      .for('update');

    if (assignment.offerState !== 'accepted') {
      throw new ConflictException('assignment offer is not active');
    }

    if (!profile || profile.operationalState !== 'assigned') {
      throw new ConflictException('assigned driver is not active');
    }

    const now = new Date();
    const persistedCancellation = await this.recordCancellation(
      tx,
      {
        requestId: request.id,
        offerId: assignment.offerId,
        assignmentId: assignment.id,
        actorUserId: riderId,
      },
      cancellation,
    );

    const [updatedRequest] = await tx
      .update(rideRequest)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(eq(rideRequest.id, request.id), eq(rideRequest.state, 'assigned')),
      )
      .returning();

    if (!updatedRequest) {
      throw new ConflictException('assigned request cancellation lost a race');
    }

    const [updatedOffer] = await tx
      .update(dispatchOffer)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(dispatchOffer.id, assignment.offerId),
          eq(dispatchOffer.state, 'accepted'),
        ),
      )
      .returning();

    if (!updatedOffer) {
      throw new ConflictException('assigned offer cancellation lost a race');
    }

    const [onlineProfile] = await tx
      .update(driverOperationalProfile)
      .set({ operationalState: 'online', updatedAt: now })
      .where(
        and(
          eq(driverOperationalProfile.userId, assignment.driverId),
          eq(driverOperationalProfile.operationalState, 'assigned'),
        ),
      )
      .returning();

    if (!onlineProfile) {
      throw new ConflictException('assigned driver release lost a race');
    }

    const payloadCancellation = {
      id: persistedCancellation.id,
      actorRole: cancellation.actorRole,
      reasonCode: cancellation.reasonCode,
      notes: cancellation.notes,
    };

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignment.id}:cancelled`,
      eventType: 'dispatch_assignment.cancelled.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignment.id,
      correlationId: randomUUID(),
      actorUserId: riderId,
      payload: {
        assignmentId: assignment.id,
        requestId: request.id,
        offerId: assignment.offerId,
        riderId,
        driverId: assignment.driverId,
        state: 'cancelled',
        cancelledAt: now.toISOString(),
        cancellation: payloadCancellation,
      },
    });

    await this.outbox.append(tx, {
      eventKey: `ride_request:${request.id}:cancelled`,
      eventType: 'ride_request.cancelled.v1',
      aggregateType: 'ride_request',
      aggregateId: request.id,
      correlationId: randomUUID(),
      actorUserId: riderId,
      payload: {
        requestId: request.id,
        riderId,
        state: 'cancelled',
        cancellation: payloadCancellation,
      },
    });

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${assignment.offerId}:cancelled`,
      eventType: 'dispatch_offer.cancelled.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: assignment.offerId,
      correlationId: randomUUID(),
      actorUserId: riderId,
      payload: {
        offerId: assignment.offerId,
        requestId: request.id,
        driverId: assignment.driverId,
        state: 'cancelled',
        cancelledAt: now.toISOString(),
        cancellation: payloadCancellation,
      },
    });

    this.metrics.recordRequestCancelled(updatedRequest.id, 'rider');

    return this.withStoredRoute(updatedRequest, tx);
  }

  private async findAssignmentForRiderCancellation(
    tx: DBTransaction,
    riderId: string,
    requestId: string,
  ): Promise<AssignmentForRiderCancellation> {
    const [row] = await tx
      .select({
        id: dispatchAssignment.id,
        requestId: dispatchAssignment.requestId,
        offerId: dispatchAssignment.offerId,
        riderId: dispatchAssignment.riderId,
        driverId: dispatchAssignment.driverId,
        offerState: dispatchOffer.state,
      })
      .from(dispatchAssignment)
      .innerJoin(
        dispatchOffer,
        eq(dispatchOffer.id, dispatchAssignment.offerId),
      )
      .where(
        and(
          eq(dispatchAssignment.requestId, requestId),
          eq(dispatchAssignment.riderId, riderId),
        ),
      )
      .limit(1)
      .for('update');

    if (!row) {
      throw new ConflictException('assignment snapshot is unavailable');
    }

    return row;
  }

  private async findExistingForIdempotency(
    riderId: string,
    idempotencyKey: string,
    tx: DBTransaction,
  ): Promise<RideRequest | null> {
    const [existing] = await tx
      .select()
      .from(rideRequest)
      .where(
        and(
          eq(rideRequest.riderId, riderId),
          eq(rideRequest.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return existing ?? null;
  }

  private async assertPayloadMatch(
    existingId: string,
    input: CreateRideRequestInput,
    tx: DBTransaction,
  ): Promise<void> {
    const result = await tx.execute(sql`
      SELECT
        ST_X("pickup"::geometry)::float8 AS pickup_lon,
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("destination"::geometry)::float8 AS dest_lon,
        ST_Y("destination"::geometry)::float8 AS dest_lat,
        "fare_estimate_id" AS fare_estimate_id
      FROM "ride_request"
      WHERE "id" = ${existingId}
    `);

    const stored = result.rows?.[0] as
      | {
          pickup_lon: number;
          pickup_lat: number;
          dest_lon: number;
          dest_lat: number;
          fare_estimate_id: string | null;
        }
      | undefined;
    if (
      !stored ||
      ROUND(stored.pickup_lon) !== ROUND(input.pickup.longitude) ||
      ROUND(stored.pickup_lat) !== ROUND(input.pickup.latitude) ||
      ROUND(stored.dest_lon) !== ROUND(input.destination.longitude) ||
      ROUND(stored.dest_lat) !== ROUND(input.destination.latitude) ||
      stored.fare_estimate_id !== input.fareEstimateId
    ) {
      throw new ConflictException(
        'idempotency key conflict: payload does not match existing request',
      );
    }
  }

  private async findFareEstimateForRequest(
    input: CreateRideRequestInput,
    tx: DBTransaction,
  ): Promise<FareEstimateForRequest> {
    const result = await tx.execute(sql`
      SELECT
        "id",
        "rider_id" AS "riderId",
        ST_X("pickup"::geometry)::float8 AS "pickupLon",
        ST_Y("pickup"::geometry)::float8 AS "pickupLat",
        ST_X("destination"::geometry)::float8 AS "destinationLon",
        ST_Y("destination"::geometry)::float8 AS "destinationLat",
        "vehicle_type" AS "vehicleType",
        "currency",
        "distance_meters" AS "distanceMeters",
        "duration_seconds" AS "durationSeconds",
        "rate_minor_per_km" AS "rateMinorPerKm",
        "estimated_fare_minor" AS "estimatedFareMinor",
        "expires_at" AS "expiresAt"
      FROM "fare_estimate"
      WHERE "id" = ${input.fareEstimateId}
        AND "rider_id" = ${input.riderId}
      LIMIT 1
      FOR UPDATE
    `);

    const row = result.rows?.[0] as FareEstimateRow | undefined;
    if (!row) throw new NotFoundException('fare estimate not found');
    return {
      ...row,
      expiresAt:
        row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt),
    };
  }

  private async findRequestForFareEstimate(
    fareEstimateId: string,
    tx: DBTransaction,
  ): Promise<RideRequest | null> {
    const [existing] = await tx
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.fareEstimateId, fareEstimateId))
      .limit(1)
      .for('update');

    return existing ?? null;
  }

  private assertFareEstimatePayloadMatch(
    input: CreateRideRequestInput,
    estimate: FareEstimateForRequest,
  ): void {
    if (
      ROUND(estimate.pickupLon) !== ROUND(input.pickup.longitude) ||
      ROUND(estimate.pickupLat) !== ROUND(input.pickup.latitude) ||
      ROUND(estimate.destinationLon) !== ROUND(input.destination.longitude) ||
      ROUND(estimate.destinationLat) !== ROUND(input.destination.latitude)
    ) {
      throw new ConflictException(
        'fare estimate route does not match request route',
      );
    }
  }

  private withInputRoute(
    request: RideRequest,
    input: CreateRideRequestInput,
    assignment: RideRequestAssignment | null,
  ): RideRequestSnapshot {
    return {
      ...request,
      pickup: input.pickup,
      destination: input.destination,
      assignment,
      cancellation: null,
    };
  }

  private async withStoredRoute(
    request: RideRequest,
    executor: DBExecutor,
  ): Promise<RideRequestSnapshot> {
    const result = await executor.execute(sql`
      SELECT
        ST_X("pickup"::geometry)::float8 AS pickup_lon,
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("destination"::geometry)::float8 AS destination_lon,
        ST_Y("destination"::geometry)::float8 AS destination_lat
      FROM "ride_request"
      WHERE "id" = ${request.id}
      LIMIT 1
    `);
    const route = result.rows?.[0] as RideRequestRouteRow | undefined;
    if (!route) throw new Error('ride request route lookup returned no row');

    return {
      ...request,
      pickup: {
        latitude: route.pickup_lat,
        longitude: route.pickup_lon,
      },
      destination: {
        latitude: route.destination_lat,
        longitude: route.destination_lon,
      },
      assignment: await this.findAssignmentForRequest(request.id, executor),
      cancellation: await this.findCancellationForRequest(request.id, executor),
    };
  }

  private async findCancellationForRequest(
    requestId: string,
    executor: DBExecutor,
  ): Promise<RideRequestCancellation | null> {
    const [row] = await executor
      .select()
      .from(dispatchCancellation)
      .where(eq(dispatchCancellation.requestId, requestId))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      requestId: row.requestId,
      offerId: row.offerId,
      assignmentId: row.assignmentId,
      actorUserId: row.actorUserId,
      actorRole: row.actorRole,
      reasonCode: row.reasonCode,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }

  private async findAssignmentForRequest(
    requestId: string,
    executor: DBExecutor,
  ): Promise<RideRequestAssignment | null> {
    const result = await executor.execute(sql`
      SELECT
        a."id",
        a."offer_id",
        a."request_id",
        a."rider_id",
        a."driver_id",
        a."assigned_at",
        a."driver_full_name",
        a."driver_phone",
        a."driver_rating",
        a."vehicle_make",
        a."vehicle_model",
        a."vehicle_color",
        a."vehicle_plate_region",
        a."vehicle_plate_code",
        a."vehicle_plate_code_subtype",
        a."vehicle_plate_number",
        t."id" AS trip_id,
        t."state" AS trip_state,
        t."started_at" AS trip_started_at,
        t."completed_at" AS trip_completed_at,
        p."id" AS pickup_id,
        p."state" AS pickup_state,
        p."arrived_at" AS pickup_arrived_at,
        p."warning_due_at" AS pickup_warning_due_at,
        p."warning_sent_at" AS pickup_warning_sent_at,
        p."no_show_cancellable_at" AS pickup_no_show_cancellable_at,
        p."no_show_cancelled_at" AS pickup_no_show_cancelled_at
      FROM "dispatch_assignment" a
      LEFT JOIN "dispatch_assignment_trip" t
        ON t."assignment_id" = a."id"
      LEFT JOIN "dispatch_assignment_pickup" p
        ON p."assignment_id" = a."id"
      WHERE a."request_id" = ${requestId}
      LIMIT 1
    `);
    const row = result.rows?.[0] as RideRequestAssignmentRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      offerId: row.offer_id,
      requestId: row.request_id,
      riderId: row.rider_id,
      driverId: row.driver_id,
      state: 'assigned',
      assignedAt:
        row.assigned_at instanceof Date
          ? row.assigned_at
          : new Date(row.assigned_at),
      driver: {
        id: row.driver_id,
        fullName: row.driver_full_name,
        phone: row.driver_phone,
        rating: row.driver_rating,
      },
      vehicle: {
        make: row.vehicle_make,
        model: row.vehicle_model,
        color: row.vehicle_color,
        plateRegion: row.vehicle_plate_region,
        plateCode: row.vehicle_plate_code,
        plateCodeSubtype: row.vehicle_plate_code_subtype,
        plateNumber: row.vehicle_plate_number,
      },
      trip:
        row.trip_id && row.trip_state && row.trip_started_at
          ? {
              id: row.trip_id,
              state: row.trip_state,
              startedAt: this.toDate(row.trip_started_at),
              completedAt: row.trip_completed_at
                ? this.toDate(row.trip_completed_at)
                : null,
            }
          : null,
      pickup:
        row.pickup_id && row.pickup_state && row.pickup_arrived_at
          ? {
              id: row.pickup_id,
              state: row.pickup_state,
              arrivedAt: this.toDate(row.pickup_arrived_at),
              warningDueAt: this.toDate(row.pickup_warning_due_at),
              warningSentAt: row.pickup_warning_sent_at
                ? this.toDate(row.pickup_warning_sent_at)
                : null,
              noShowCancellableAt: this.toDate(
                row.pickup_no_show_cancellable_at,
              ),
              noShowCancelledAt: row.pickup_no_show_cancelled_at
                ? this.toDate(row.pickup_no_show_cancelled_at)
                : null,
            }
          : null,
    };
  }

  private toDate(value: Date | string | null): Date {
    if (!value) throw new Error('expected timestamp value');
    return value instanceof Date ? value : new Date(value);
  }

  private async findActiveForRider(
    riderId: string,
    tx: DBTransaction,
  ): Promise<RideRequest | null> {
    const [existing] = await tx
      .select()
      .from(rideRequest)
      .where(
        and(
          eq(rideRequest.riderId, riderId),
          sql`${rideRequest.state} IN ('searching', 'offered')`,
        ),
      )
      .limit(1)
      .for('update');

    return existing ?? null;
  }

  private isPickupWithinRolloutBounds(pickup: {
    latitude: number;
    longitude: number;
  }): boolean {
    const bounds = this.config.rolloutPickupBounds;
    if (!bounds) {
      return true;
    }

    return (
      pickup.latitude >= bounds.minLatitude &&
      pickup.latitude <= bounds.maxLatitude &&
      pickup.longitude >= bounds.minLongitude &&
      pickup.longitude <= bounds.maxLongitude
    );
  }

  private isWithinRolloutHours(now: Date): boolean {
    const rolloutHours = this.config.rolloutHours;
    if (!rolloutHours) {
      return true;
    }

    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: rolloutHours.timezone,
      }).format(now),
    );
    if (Number.isNaN(hour)) {
      throw new Error('failed to derive rollout local hour');
    }

    if (rolloutHours.startHourLocal < rolloutHours.endHourLocal) {
      return (
        hour >= rolloutHours.startHourLocal && hour < rolloutHours.endHourLocal
      );
    }

    return (
      hour >= rolloutHours.startHourLocal || hour < rolloutHours.endHourLocal
    );
  }
}
