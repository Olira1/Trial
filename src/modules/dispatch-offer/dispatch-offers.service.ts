import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import { rideRequest } from '../ride-requests/schema';
import {
  dispatchAssignment,
  dispatchAssignmentPickup,
  dispatchAssignmentTrip,
  dispatchCancellation,
  dispatchOffer,
} from './schema';

export type CurrentDispatchOffer = {
  id: string;
  assignmentId: string | null;
  requestId: string;
  driverId: string;
  state: typeof dispatchOffer.$inferSelect.state;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  fareEstimateId: string | null;
  vehicleType: 'standard' | null;
  rideType: 'instant' | null;
  currency: 'ETB' | null;
  tripDistanceMeters: number | null;
  tripDurationSeconds: number | null;
  rateMinorPerKm: number | null;
  estimatedFareMinor: number | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  expiresAt: Date;
  offeredAt: Date;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActiveDispatchAssignment = {
  id: string;
  assignmentId: string;
  offerId: string;
  requestId: string;
  riderId: string;
  driverId: string;
  state: 'assigned';
  status: 'assigned';
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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

export type DispatchAssignmentHistoryInput = {
  limit: number;
  offset: number;
};

export type DispatchAssignmentHistoryResult = {
  items: Array<{
    id: string;
    riderId: string;
    state: typeof rideRequest.$inferSelect.state;
    pickup: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    fareEstimateId: string | null;
    vehicleType: 'standard' | null;
    rideType: 'instant' | null;
    currency: 'ETB' | null;
    distanceMeters: number | null;
    durationSeconds: number | null;
    rateMinorPerKm: number | null;
    estimatedFareMinor: number | null;
    assignment: {
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
    } | null;
    cancellation: {
      id: string;
      requestId: string;
      offerId: string | null;
      assignmentId: string | null;
      actorUserId: string;
      actorRole: 'rider' | 'driver' | 'system';
      reasonCode:
        | 'generic'
        | 'wrong_pickup'
        | 'rider_changed_mind'
        | 'driver_delay'
        | 'driver_requested'
        | 'driver_emergency'
        | 'driver_no_show'
        | 'rider_no_show'
        | 'other';
      notes: string | null;
      createdAt: Date;
    } | null;
    idempotencyKey: string;
    offerTtlSeconds: number;
    matchingDeadlineSeconds: number;
    matchingDeadlineAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
  limit: number;
  offset: number;
};

@Injectable()
export class DispatchOffersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findCurrentForDriver(
    driverId: string,
  ): Promise<CurrentDispatchOffer | null> {
    const [offer] = await this.db
      .select({
        id: dispatchOffer.id,
        assignmentId: dispatchAssignment.id,
        requestId: dispatchOffer.requestId,
        driverId: dispatchOffer.driverId,
        state: dispatchOffer.state,
        pickupLatitude: sql<number>`ST_Y(${rideRequest.pickup}::geometry)::float8`,
        pickupLongitude: sql<number>`ST_X(${rideRequest.pickup}::geometry)::float8`,
        destinationLatitude: sql<number>`ST_Y(${rideRequest.destination}::geometry)::float8`,
        destinationLongitude: sql<number>`ST_X(${rideRequest.destination}::geometry)::float8`,
        fareEstimateId: rideRequest.fareEstimateId,
        vehicleType: rideRequest.vehicleType,
        rideType: rideRequest.rideType,
        currency: rideRequest.currency,
        tripDistanceMeters: rideRequest.distanceMeters,
        tripDurationSeconds: rideRequest.durationSeconds,
        rateMinorPerKm: rideRequest.rateMinorPerKm,
        estimatedFareMinor: rideRequest.estimatedFareMinor,
        etaSeconds: dispatchOffer.etaSeconds,
        distanceMeters: dispatchOffer.distanceMeters,
        expiresAt: dispatchOffer.expiresAt,
        offeredAt: dispatchOffer.offeredAt,
        respondedAt: dispatchOffer.respondedAt,
        createdAt: dispatchOffer.createdAt,
        updatedAt: dispatchOffer.updatedAt,
      })
      .from(dispatchOffer)
      .innerJoin(rideRequest, eq(rideRequest.id, dispatchOffer.requestId))
      .leftJoin(
        dispatchAssignment,
        eq(dispatchAssignment.offerId, dispatchOffer.id),
      )
      .where(
        and(
          eq(dispatchOffer.driverId, driverId),
          sql`${dispatchOffer.state} IN ('pending', 'accepted')`,
          sql`${rideRequest.state} IN ('offered', 'assigned')`,
        ),
      )
      .orderBy(
        sql`CASE WHEN ${dispatchOffer.state} = 'pending' THEN 0 ELSE 1 END`,
        desc(dispatchOffer.offeredAt),
      )
      .limit(1);

    if (!offer) {
      return null;
    }

    return {
      id: offer.id,
      assignmentId: offer.assignmentId,
      requestId: offer.requestId,
      driverId: offer.driverId,
      state: offer.state,
      pickup: {
        latitude: offer.pickupLatitude,
        longitude: offer.pickupLongitude,
      },
      destination: {
        latitude: offer.destinationLatitude,
        longitude: offer.destinationLongitude,
      },
      fareEstimateId: offer.fareEstimateId,
      vehicleType: offer.vehicleType as 'standard' | null,
      rideType: offer.rideType as 'instant' | null,
      currency: offer.currency as 'ETB' | null,
      tripDistanceMeters: offer.tripDistanceMeters,
      tripDurationSeconds: offer.tripDurationSeconds,
      rateMinorPerKm: offer.rateMinorPerKm,
      estimatedFareMinor: offer.estimatedFareMinor,
      etaSeconds: offer.etaSeconds,
      distanceMeters: offer.distanceMeters,
      expiresAt: offer.expiresAt,
      offeredAt: offer.offeredAt,
      respondedAt: offer.respondedAt,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
    };
  }

  async findOfferByIdForDriver(
    driverId: string,
    offerId: string,
  ): Promise<CurrentDispatchOffer> {
    return this.db.transaction(async (tx) => {
      const [offer] = await tx
        .select({
          id: dispatchOffer.id,
          assignmentId: dispatchAssignment.id,
          requestId: dispatchOffer.requestId,
          driverId: dispatchOffer.driverId,
          state: dispatchOffer.state,
          pickupLatitude: sql<number>`ST_Y(${rideRequest.pickup}::geometry)::float8`,
          pickupLongitude: sql<number>`ST_X(${rideRequest.pickup}::geometry)::float8`,
          destinationLatitude: sql<number>`ST_Y(${rideRequest.destination}::geometry)::float8`,
          destinationLongitude: sql<number>`ST_X(${rideRequest.destination}::geometry)::float8`,
          fareEstimateId: rideRequest.fareEstimateId,
          vehicleType: rideRequest.vehicleType,
          rideType: rideRequest.rideType,
          currency: rideRequest.currency,
          tripDistanceMeters: rideRequest.distanceMeters,
          tripDurationSeconds: rideRequest.durationSeconds,
          rateMinorPerKm: rideRequest.rateMinorPerKm,
          estimatedFareMinor: rideRequest.estimatedFareMinor,
          etaSeconds: dispatchOffer.etaSeconds,
          distanceMeters: dispatchOffer.distanceMeters,
          expiresAt: dispatchOffer.expiresAt,
          offeredAt: dispatchOffer.offeredAt,
          respondedAt: dispatchOffer.respondedAt,
          createdAt: dispatchOffer.createdAt,
          updatedAt: dispatchOffer.updatedAt,
        })
        .from(dispatchOffer)
        .innerJoin(rideRequest, eq(rideRequest.id, dispatchOffer.requestId))
        .leftJoin(
          dispatchAssignment,
          eq(dispatchAssignment.offerId, dispatchOffer.id),
        )
        .where(
          and(
            eq(dispatchOffer.id, offerId),
            eq(dispatchOffer.driverId, driverId),
          ),
        )
        .limit(1);

      if (!offer) {
        throw new NotFoundException('dispatch offer not found');
      }

      return {
        id: offer.id,
        assignmentId: offer.assignmentId,
        requestId: offer.requestId,
        driverId: offer.driverId,
        state: offer.state,
        pickup: {
          latitude: offer.pickupLatitude,
          longitude: offer.pickupLongitude,
        },
        destination: {
          latitude: offer.destinationLatitude,
          longitude: offer.destinationLongitude,
        },
        fareEstimateId: offer.fareEstimateId,
        vehicleType: offer.vehicleType as 'standard' | null,
        rideType: offer.rideType as 'instant' | null,
        currency: offer.currency as 'ETB' | null,
        tripDistanceMeters: offer.tripDistanceMeters,
        tripDurationSeconds: offer.tripDurationSeconds,
        rateMinorPerKm: offer.rateMinorPerKm,
        estimatedFareMinor: offer.estimatedFareMinor,
        etaSeconds: offer.etaSeconds,
        distanceMeters: offer.distanceMeters,
        expiresAt: offer.expiresAt,
        offeredAt: offer.offeredAt,
        respondedAt: offer.respondedAt,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
      };
    });
  }

  async findActiveAssignmentForDriver(
    driverId: string,
  ): Promise<ActiveDispatchAssignment | null> {
    return this.db.transaction(async (tx) => {
      const [assignment] = await tx
        .select({
          id: dispatchAssignment.id,
          offerId: dispatchAssignment.offerId,
          requestId: dispatchAssignment.requestId,
          riderId: dispatchAssignment.riderId,
          driverId: dispatchAssignment.driverId,
          assignedAt: dispatchAssignment.assignedAt,
          createdAt: dispatchAssignment.createdAt,
          updatedAt: dispatchAssignment.updatedAt,
          driverFullName: dispatchAssignment.driverFullName,
          driverPhone: dispatchAssignment.driverPhone,
          driverRating: dispatchAssignment.driverRating,
          vehicleMake: dispatchAssignment.vehicleMake,
          vehicleModel: dispatchAssignment.vehicleModel,
          vehicleColor: dispatchAssignment.vehicleColor,
          vehiclePlateRegion: dispatchAssignment.vehiclePlateRegion,
          vehiclePlateCode: dispatchAssignment.vehiclePlateCode,
          vehiclePlateCodeSubtype: dispatchAssignment.vehiclePlateCodeSubtype,
          vehiclePlateNumber: dispatchAssignment.vehiclePlateNumber,
          tripId: dispatchAssignmentTrip.id,
          tripState: dispatchAssignmentTrip.state,
          tripStartedAt: dispatchAssignmentTrip.startedAt,
          tripCompletedAt: dispatchAssignmentTrip.completedAt,
          pickupId: dispatchAssignmentPickup.id,
          pickupState: dispatchAssignmentPickup.state,
          pickupArrivedAt: dispatchAssignmentPickup.arrivedAt,
          pickupWarningDueAt: dispatchAssignmentPickup.warningDueAt,
          pickupWarningSentAt: dispatchAssignmentPickup.warningSentAt,
          pickupNoShowCancellableAt:
            dispatchAssignmentPickup.noShowCancellableAt,
          pickupNoShowCancelledAt: dispatchAssignmentPickup.noShowCancelledAt,
        })
        .from(dispatchAssignment)
        .innerJoin(
          dispatchOffer,
          eq(dispatchOffer.id, dispatchAssignment.offerId),
        )
        .innerJoin(
          rideRequest,
          eq(rideRequest.id, dispatchAssignment.requestId),
        )
        .leftJoin(
          dispatchAssignmentTrip,
          eq(dispatchAssignmentTrip.assignmentId, dispatchAssignment.id),
        )
        .leftJoin(
          dispatchAssignmentPickup,
          eq(dispatchAssignmentPickup.assignmentId, dispatchAssignment.id),
        )
        .where(
          and(
            eq(dispatchAssignment.driverId, driverId),
            eq(dispatchOffer.state, 'accepted'),
            eq(rideRequest.state, 'assigned'),
          ),
        )
        .orderBy(desc(dispatchAssignment.assignedAt))
        .limit(1);

      if (!assignment) {
        return null;
      }

      return {
        id: assignment.id,
        assignmentId: assignment.id,
        offerId: assignment.offerId,
        requestId: assignment.requestId,
        riderId: assignment.riderId,
        driverId: assignment.driverId,
        state: 'assigned',
        status: 'assigned',
        assignedAt: assignment.assignedAt,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
        driver: {
          id: assignment.driverId,
          fullName: assignment.driverFullName,
          phone: assignment.driverPhone,
          rating: assignment.driverRating,
        },
        vehicle: {
          make: assignment.vehicleMake,
          model: assignment.vehicleModel,
          color: assignment.vehicleColor,
          plateRegion: assignment.vehiclePlateRegion,
          plateCode: assignment.vehiclePlateCode,
          plateCodeSubtype: assignment.vehiclePlateCodeSubtype,
          plateNumber: assignment.vehiclePlateNumber,
        },
        trip:
          assignment.tripId && assignment.tripState && assignment.tripStartedAt
            ? {
                id: assignment.tripId,
                state: assignment.tripState,
                startedAt: assignment.tripStartedAt,
                completedAt: assignment.tripCompletedAt,
              }
            : null,
        pickup:
          assignment.pickupId &&
          assignment.pickupState &&
          assignment.pickupArrivedAt
            ? {
                id: assignment.pickupId,
                state: assignment.pickupState,
                arrivedAt: assignment.pickupArrivedAt,
                warningDueAt: assignment.pickupWarningDueAt!,
                warningSentAt: assignment.pickupWarningSentAt,
                noShowCancellableAt: assignment.pickupNoShowCancellableAt!,
                noShowCancelledAt: assignment.pickupNoShowCancelledAt,
              }
            : null,
      };
    });
  }

  async findHistoryForDriver(
    driverId: string,
    input: DispatchAssignmentHistoryInput,
  ): Promise<DispatchAssignmentHistoryResult> {
    return this.db.transaction(async (tx) => {
      const historyWhere = and(
        eq(dispatchAssignment.driverId, driverId),
        sql`${rideRequest.state} IN ('completed', 'cancelled', 'expired', 'no_driver_found', 'system_failed')`,
      );

      const [countRow] = await tx
        .select({ total: count() })
        .from(dispatchAssignment)
        .innerJoin(
          rideRequest,
          eq(rideRequest.id, dispatchAssignment.requestId),
        )
        .where(historyWhere);

      const requests = await tx
        .select({
          requestId: rideRequest.id,
          riderId: rideRequest.riderId,
          state: rideRequest.state,
          pickupLon: sql<number>`ST_X(${rideRequest.pickup}::geometry)::float8`,
          pickupLat: sql<number>`ST_Y(${rideRequest.pickup}::geometry)::float8`,
          destinationLon: sql<number>`ST_X(${rideRequest.destination}::geometry)::float8`,
          destinationLat: sql<number>`ST_Y(${rideRequest.destination}::geometry)::float8`,
          fareEstimateId: rideRequest.fareEstimateId,
          vehicleType: rideRequest.vehicleType,
          rideType: rideRequest.rideType,
          currency: rideRequest.currency,
          distanceMeters: rideRequest.distanceMeters,
          durationSeconds: rideRequest.durationSeconds,
          rateMinorPerKm: rideRequest.rateMinorPerKm,
          estimatedFareMinor: rideRequest.estimatedFareMinor,
          idempotencyKey: rideRequest.idempotencyKey,
          offerTtlSeconds: rideRequest.offerTtlSeconds,
          matchingDeadlineSeconds: rideRequest.matchingDeadlineSeconds,
          matchingDeadlineAt: rideRequest.matchingDeadlineAt,
          createdAt: rideRequest.createdAt,
          updatedAt: rideRequest.updatedAt,
          assignmentId: dispatchAssignment.id,
          offerId: dispatchAssignment.offerId,
          assignmentRiderId: dispatchAssignment.riderId,
          driverId: dispatchAssignment.driverId,
          assignedAt: dispatchAssignment.assignedAt,
          driverFullName: dispatchAssignment.driverFullName,
          driverPhone: dispatchAssignment.driverPhone,
          driverRating: dispatchAssignment.driverRating,
          vehicleMake: dispatchAssignment.vehicleMake,
          vehicleModel: dispatchAssignment.vehicleModel,
          vehicleColor: dispatchAssignment.vehicleColor,
          vehiclePlateRegion: dispatchAssignment.vehiclePlateRegion,
          vehiclePlateCode: dispatchAssignment.vehiclePlateCode,
          vehiclePlateCodeSubtype: dispatchAssignment.vehiclePlateCodeSubtype,
          vehiclePlateNumber: dispatchAssignment.vehiclePlateNumber,
          tripId: dispatchAssignmentTrip.id,
          tripState: dispatchAssignmentTrip.state,
          tripStartedAt: dispatchAssignmentTrip.startedAt,
          tripCompletedAt: dispatchAssignmentTrip.completedAt,
          cancellationId: dispatchCancellation.id,
          cancellationRequestId: dispatchCancellation.requestId,
          cancellationOfferId: dispatchCancellation.offerId,
          cancellationAssignmentId: dispatchCancellation.assignmentId,
          cancellationActorUserId: dispatchCancellation.actorUserId,
          cancellationActorRole: dispatchCancellation.actorRole,
          cancellationReasonCode: dispatchCancellation.reasonCode,
          cancellationNotes: dispatchCancellation.notes,
          cancellationCreatedAt: dispatchCancellation.createdAt,
        })
        .from(dispatchAssignment)
        .innerJoin(
          rideRequest,
          eq(rideRequest.id, dispatchAssignment.requestId),
        )
        .leftJoin(
          dispatchAssignmentTrip,
          eq(dispatchAssignmentTrip.assignmentId, dispatchAssignment.id),
        )
        .leftJoin(
          dispatchCancellation,
          eq(dispatchCancellation.requestId, rideRequest.id),
        )
        .where(historyWhere)
        .orderBy(
          desc(rideRequest.updatedAt),
          desc(rideRequest.createdAt),
          desc(rideRequest.id),
        )
        .limit(input.limit)
        .offset(input.offset);

      const items = requests.map((row) => ({
        id: row.requestId,
        riderId: row.riderId,
        state: row.state,
        pickup: {
          latitude: row.pickupLat,
          longitude: row.pickupLon,
        },
        destination: {
          latitude: row.destinationLat,
          longitude: row.destinationLon,
        },
        fareEstimateId: row.fareEstimateId,
        vehicleType: row.vehicleType as 'standard' | null,
        rideType: row.rideType as 'instant' | null,
        currency: row.currency as 'ETB' | null,
        distanceMeters: row.distanceMeters,
        durationSeconds: row.durationSeconds,
        rateMinorPerKm: row.rateMinorPerKm,
        estimatedFareMinor: row.estimatedFareMinor,
        assignment: {
          id: row.assignmentId,
          offerId: row.offerId,
          requestId: row.requestId,
          riderId: row.assignmentRiderId,
          driverId: row.driverId,
          state: 'assigned' as const,
          assignedAt: row.assignedAt,
          driver: {
            id: row.driverId,
            fullName: row.driverFullName,
            phone: row.driverPhone,
            rating: row.driverRating,
          },
          vehicle: {
            make: row.vehicleMake,
            model: row.vehicleModel,
            color: row.vehicleColor,
            plateRegion: row.vehiclePlateRegion,
            plateCode: row.vehiclePlateCode,
            plateCodeSubtype: row.vehiclePlateCodeSubtype,
            plateNumber: row.vehiclePlateNumber,
          },
          trip:
            row.tripId && row.tripState && row.tripStartedAt
              ? {
                  id: row.tripId,
                  state: row.tripState,
                  startedAt: row.tripStartedAt,
                  completedAt: row.tripCompletedAt,
                }
              : null,
        },
        cancellation: row.cancellationId
          ? {
              id: row.cancellationId,
              requestId: row.cancellationRequestId!,
              offerId: row.cancellationOfferId,
              assignmentId: row.cancellationAssignmentId,
              actorUserId: row.cancellationActorUserId!,
              actorRole: row.cancellationActorRole!,
              reasonCode: row.cancellationReasonCode!,
              notes: row.cancellationNotes,
              createdAt: row.cancellationCreatedAt!,
            }
          : null,
        idempotencyKey: row.idempotencyKey,
        offerTtlSeconds: row.offerTtlSeconds,
        matchingDeadlineSeconds: row.matchingDeadlineSeconds,
        matchingDeadlineAt: row.matchingDeadlineAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return {
        items,
        total: Number(countRow?.total ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    });
  }
}
