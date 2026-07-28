import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { user as userTable } from '../user';
import { dispatchAssignment } from './schema/dispatch-assignment.schema';
import {
  dispatchAssignmentTrip,
  type DispatchAssignmentTrip,
} from './schema/dispatch-assignment-trip.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

type AssignmentForTrip = {
  id: string;
  requestId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  requestState: typeof rideRequest.$inferSelect.state;
  offerState: typeof dispatchOffer.$inferSelect.state;
  riderFirstName: string;
  riderMiddleName: string | null;
  riderLastName: string;
  riderPhone: string | null;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  currency: string | null;
  distanceMeters: number | null;
  estimatedFareMinor: number | null;
};

type DispatchAssignmentTripResponse = DispatchAssignmentTrip & {
  rider: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
  };
  pickup: {
    latitude: number;
    longitude: number;
  };
  destination: {
    latitude: number;
    longitude: number;
  };
  completion: {
    totalPriceMinor: number | null;
    currency: string | null;
    totalDistanceMeters: number | null;
    totalTimeTakenSeconds: number;
  } | null;
};

const DEFAULT_RIDER_RATING = 5;

@Injectable()
export class DispatchAssignmentTripService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: DispatchOutboxService,
  ) {}

  async startTrip(
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentTripResponse> {
    return this.db.transaction((tx) =>
      this.startTripInTransaction(tx, driverId, assignmentId),
    );
  }

  async completeTrip(
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentTripResponse> {
    return this.db.transaction((tx) =>
      this.completeTripInTransaction(tx, driverId, assignmentId),
    );
  }

  private async startTripInTransaction(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentTripResponse> {
    const assignment = await this.loadAssignmentForTrip(
      tx,
      driverId,
      assignmentId,
    );

    const existing = await this.findExistingTrip(tx, assignmentId);
    if (existing) return this.toTripResponse(existing, assignment);

    if (
      assignment.requestState !== 'assigned' ||
      assignment.offerState !== 'accepted'
    ) {
      throw new ConflictException('assignment is not active for trip start');
    }

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1)
      .for('update');

    if (!profile || profile.operationalState !== 'assigned') {
      throw new ConflictException('driver is not assigned for trip start');
    }

    const now = new Date();
    const [created] = await tx
      .insert(dispatchAssignmentTrip)
      .values({
        assignmentId,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId,
        state: 'started',
        startedAt: now,
      })
      .onConflictDoNothing({
        target: dispatchAssignmentTrip.assignmentId,
      })
      .returning();

    if (!created) {
      const racedExisting = await this.findExistingTrip(tx, assignmentId);
      if (racedExisting) return this.toTripResponse(racedExisting, assignment);
      throw new ConflictException('trip start lost a race');
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignmentId}:trip_started`,
      eventType: 'dispatch_assignment.trip_started.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignmentId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        tripId: created.id,
        assignmentId,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId,
        state: 'started',
        startedAt: created.startedAt.toISOString(),
      },
    });

    return this.toTripResponse(created, assignment);
  }

  private async completeTripInTransaction(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentTripResponse> {
    const assignment = await this.loadAssignmentForTrip(
      tx,
      driverId,
      assignmentId,
    );

    const existing = await this.findExistingTrip(tx, assignmentId);
    if (!existing) {
      throw new ConflictException('trip has not started');
    }
    if (existing.state === 'completed') {
      return this.toTripResponse(existing, assignment);
    }

    if (
      assignment.requestState !== 'assigned' ||
      assignment.offerState !== 'accepted'
    ) {
      throw new ConflictException(
        'assignment is not active for trip completion',
      );
    }

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1)
      .for('update');

    if (!profile || profile.operationalState !== 'assigned') {
      throw new ConflictException('driver is not assigned for trip completion');
    }

    const now = new Date();
    const [completed] = await tx
      .update(dispatchAssignmentTrip)
      .set({
        state: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(dispatchAssignmentTrip.id, existing.id),
          eq(dispatchAssignmentTrip.state, 'started'),
        ),
      )
      .returning();

    if (!completed) {
      const racedExisting = await this.findExistingTrip(tx, assignmentId);
      if (racedExisting?.state === 'completed') {
        return this.toTripResponse(racedExisting, assignment);
      }
      throw new ConflictException('trip completion lost a race');
    }

    const [completedRequest] = await tx
      .update(rideRequest)
      .set({ state: 'completed', updatedAt: now })
      .where(
        and(
          eq(rideRequest.id, assignment.requestId),
          eq(rideRequest.state, 'assigned'),
        ),
      )
      .returning();

    if (!completedRequest) {
      throw new ConflictException('request completion lost a race');
    }

    const [onlineProfile] = await tx
      .update(driverOperationalProfile)
      .set({ operationalState: 'online', updatedAt: now })
      .where(
        and(
          eq(driverOperationalProfile.userId, driverId),
          eq(driverOperationalProfile.operationalState, 'assigned'),
        ),
      )
      .returning();

    if (!onlineProfile) {
      throw new ConflictException('driver release lost a race');
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignmentId}:trip_completed`,
      eventType: 'dispatch_assignment.trip_completed.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignmentId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        tripId: completed.id,
        assignmentId,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId,
        state: 'completed',
        startedAt: completed.startedAt.toISOString(),
        completedAt: completed.completedAt?.toISOString() ?? null,
      },
    });

    return this.toTripResponse(completed, assignment);
  }

  private async loadAssignmentForTrip(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<AssignmentForTrip> {
    const [row] = await tx
      .select({
        id: dispatchAssignment.id,
        requestId: dispatchAssignment.requestId,
        offerId: dispatchAssignment.offerId,
        riderId: dispatchAssignment.riderId,
        driverId: dispatchAssignment.driverId,
        requestState: rideRequest.state,
        offerState: dispatchOffer.state,
        riderFirstName: userTable.firstName,
        riderMiddleName: userTable.middleName,
        riderLastName: userTable.lastName,
        riderPhone: sql<string | null>`(
          SELECT ai."identifier"
          FROM "auth_identity" ai
          WHERE ai."user_id" = ${dispatchAssignment.riderId}
            AND ai."type" = 'phone'
            AND ai."verified_at" IS NOT NULL
          ORDER BY ai."verified_at" DESC, ai."updated_at" DESC, ai."id" DESC
          LIMIT 1
        )`,
        pickupLatitude: sql<number>`ST_Y(${rideRequest.pickup}::geometry)::float8`,
        pickupLongitude: sql<number>`ST_X(${rideRequest.pickup}::geometry)::float8`,
        destinationLatitude: sql<number>`ST_Y(${rideRequest.destination}::geometry)::float8`,
        destinationLongitude: sql<number>`ST_X(${rideRequest.destination}::geometry)::float8`,
        currency: rideRequest.currency,
        distanceMeters: rideRequest.distanceMeters,
        estimatedFareMinor: rideRequest.estimatedFareMinor,
      })
      .from(dispatchAssignment)
      .innerJoin(rideRequest, eq(rideRequest.id, dispatchAssignment.requestId))
      .innerJoin(
        dispatchOffer,
        eq(dispatchOffer.id, dispatchAssignment.offerId),
      )
      .innerJoin(userTable, eq(userTable.id, dispatchAssignment.riderId))
      .where(
        and(
          eq(dispatchAssignment.id, assignmentId),
          eq(dispatchAssignment.driverId, driverId),
        ),
      )
      .limit(1)
      .for('update');

    if (!row) {
      throw new NotFoundException('dispatch assignment not found');
    }

    return row;
  }

  private async findExistingTrip(
    tx: DBTransaction,
    assignmentId: string,
  ): Promise<DispatchAssignmentTrip | null> {
    const [existing] = await tx
      .select()
      .from(dispatchAssignmentTrip)
      .where(eq(dispatchAssignmentTrip.assignmentId, assignmentId))
      .limit(1)
      .for('update');

    return existing ?? null;
  }

  private toTripResponse(
    trip: DispatchAssignmentTrip,
    assignment: AssignmentForTrip,
  ): DispatchAssignmentTripResponse {
    if (!assignment.riderPhone) {
      throw new ConflictException('rider phone is unavailable');
    }

    return {
      ...trip,
      rider: {
        id: assignment.riderId,
        fullName: this.formatFullName(assignment),
        phone: assignment.riderPhone,
        rating: DEFAULT_RIDER_RATING,
      },
      pickup: {
        latitude: assignment.pickupLatitude,
        longitude: assignment.pickupLongitude,
      },
      destination: {
        latitude: assignment.destinationLatitude,
        longitude: assignment.destinationLongitude,
      },
      completion:
        trip.state === 'completed' && trip.completedAt
          ? {
              totalPriceMinor: assignment.estimatedFareMinor,
              currency: assignment.currency,
              totalDistanceMeters: assignment.distanceMeters,
              totalTimeTakenSeconds: this.elapsedSeconds(
                trip.startedAt,
                trip.completedAt,
              ),
            }
          : null,
    };
  }

  private elapsedSeconds(startedAt: Date, completedAt: Date): number {
    return Math.max(
      0,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 1_000),
    );
  }

  private formatFullName(input: {
    riderFirstName: string;
    riderMiddleName: string | null;
    riderLastName: string;
  }): string {
    return [input.riderFirstName, input.riderMiddleName, input.riderLastName]
      .filter(Boolean)
      .join(' ');
  }
}
