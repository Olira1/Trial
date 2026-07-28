import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import {
  DISPATCH_METRICS,
  NOOP_DISPATCH_METRICS,
  type DispatchMetrics,
} from '../dispatch-candidate';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { dispatchAssignment } from './schema/dispatch-assignment.schema';
import {
  dispatchOffer,
  type DispatchOffer,
} from './schema/dispatch-offer.schema';

type AssignmentSnapshotSourceRow = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  driver_phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_plate_region: 'aa' | 'or' | 'ah' | 'dr' | 'tg';
  vehicle_plate_code: '01' | '02' | '03';
  vehicle_plate_code_subtype: 'transport_service' | 'other' | null;
  vehicle_plate_number: string;
};

@Injectable()
export class OfferAcceptanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: DispatchOutboxService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async accept(driverId: string, offerId: string): Promise<DispatchOffer> {
    return this.db.transaction((tx) =>
      this.acceptInTransaction(tx, driverId, offerId),
    );
  }

  private async acceptInTransaction(
    tx: DBTransaction,
    driverId: string,
    offerId: string,
  ): Promise<DispatchOffer> {
    const [offer] = await tx
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offerId))
      .limit(1)
      .for('update');

    if (!offer || offer.driverId !== driverId) {
      throw new NotFoundException('dispatch offer not found');
    }

    if (offer.state === 'accepted') {
      return offer;
    }

    if (offer.state !== 'pending') {
      throw new ConflictException(
        `cannot accept offer in state ${offer.state}`,
      );
    }

    const now = new Date();
    if (offer.expiresAt <= now) {
      throw new ConflictException('cannot accept an expired offer');
    }

    const [request] = await tx
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, offer.requestId))
      .limit(1)
      .for('update');

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1)
      .for('update');

    if (!request || request.state !== 'offered') {
      throw new ConflictException(
        `cannot accept offer for request in state ${request?.state ?? 'missing'}`,
      );
    }

    if (!profile || profile.operationalState !== 'offered') {
      throw new ConflictException(
        `cannot accept offer for driver in state ${profile?.operationalState ?? 'missing'}`,
      );
    }

    const [acceptedOffer] = await tx
      .update(dispatchOffer)
      .set({
        state: 'accepted',
        respondedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(dispatchOffer.id, offerId), eq(dispatchOffer.state, 'pending')),
      )
      .returning();

    if (!acceptedOffer) {
      throw new ConflictException('offer acceptance lost a race');
    }

    const [assignedRequest] = await tx
      .update(rideRequest)
      .set({ state: 'assigned', updatedAt: now })
      .where(
        and(
          eq(rideRequest.id, offer.requestId),
          eq(rideRequest.state, 'offered'),
        ),
      )
      .returning();

    if (!assignedRequest) {
      throw new ConflictException('request assignment lost a race');
    }

    const [assignedProfile] = await tx
      .update(driverOperationalProfile)
      .set({ operationalState: 'assigned', updatedAt: now })
      .where(
        and(
          eq(driverOperationalProfile.userId, driverId),
          eq(driverOperationalProfile.operationalState, 'offered'),
        ),
      )
      .returning();

    if (!assignedProfile) {
      throw new ConflictException('driver assignment lost a race');
    }

    await this.createAssignmentSnapshot(
      tx,
      assignedRequest,
      acceptedOffer,
      driverId,
      now,
    );

    const offerCountResult = await tx
      .select({ value: count() })
      .from(dispatchOffer)
      .where(eq(dispatchOffer.requestId, offer.requestId));
    const offerCount = offerCountResult[0]?.value ?? 0;

    this.metrics.recordOfferAccepted(
      offer.requestId,
      acceptedOffer.id,
      driverId,
      request.riderId,
    );
    this.metrics.recordRequestAssigned(
      request.id,
      request.riderId,
      driverId,
      now.getTime() - request.createdAt.getTime(),
    );
    this.metrics.recordOffersPerAssignment(offer.requestId, offerCount);

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${acceptedOffer.id}:accepted`,
      eventType: 'dispatch_offer.accepted.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: acceptedOffer.id,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        offerId: acceptedOffer.id,
        requestId: acceptedOffer.requestId,
        attemptId: acceptedOffer.attemptId,
        driverId,
        respondedAt: now.toISOString(),
      },
    });

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignedRequest.id}:created`,
      eventType: 'dispatch_assignment.created.v1',
      aggregateType: 'ride_request',
      aggregateId: assignedRequest.id,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        requestId: assignedRequest.id,
        offerId: acceptedOffer.id,
        attemptId: acceptedOffer.attemptId,
        riderId: assignedRequest.riderId,
        driverId,
        assignedAt: now.toISOString(),
      },
    });

    return acceptedOffer;
  }

  private async createAssignmentSnapshot(
    tx: DBTransaction,
    assignedRequest: typeof rideRequest.$inferSelect,
    acceptedOffer: DispatchOffer,
    driverId: string,
    assignedAt: Date,
  ): Promise<void> {
    const source = await this.loadAssignmentSnapshotSource(tx, driverId);
    const [created] = await tx
      .insert(dispatchAssignment)
      .values({
        requestId: assignedRequest.id,
        offerId: acceptedOffer.id,
        riderId: assignedRequest.riderId,
        driverId,
        assignedAt,
        driverFullName: this.formatFullName(source),
        driverPhone: source.driver_phone,
        // TODO(D10.3): replace with a real rating aggregate when the trip/review domain exists.
        driverRating: 5,
        vehicleMake: source.vehicle_make,
        vehicleModel: source.vehicle_model,
        vehicleColor: source.vehicle_color,
        vehiclePlateRegion: source.vehicle_plate_region,
        vehiclePlateCode: source.vehicle_plate_code,
        vehiclePlateCodeSubtype: source.vehicle_plate_code_subtype,
        vehiclePlateNumber: source.vehicle_plate_number,
      })
      .returning();

    if (!created) {
      throw new Error('assignment snapshot insert returned no row');
    }
  }

  private async loadAssignmentSnapshotSource(
    tx: DBTransaction,
    driverId: string,
  ): Promise<AssignmentSnapshotSourceRow> {
    const result = await tx.execute<AssignmentSnapshotSourceRow>(sql`
      SELECT
        u."first_name",
        u."middle_name",
        u."last_name",
        ai."identifier" AS driver_phone,
        v."make" AS vehicle_make,
        v."model" AS vehicle_model,
        v."color" AS vehicle_color,
        v."plate_region" AS vehicle_plate_region,
        v."plate_code" AS vehicle_plate_code,
        v."plate_code_subtype" AS vehicle_plate_code_subtype,
        v."plate_number" AS vehicle_plate_number
      FROM "user" u
      JOIN "auth_identity" ai
        ON ai."user_id" = u."id"
       AND ai."type" = 'phone'
       AND ai."verified_at" IS NOT NULL
      JOIN "vehicle" v
        ON v."user_id" = u."id"
       AND v."deleted_at" IS NULL
       AND v."is_approved" = TRUE
      WHERE u."id" = ${driverId}
        AND u."deleted_at" IS NULL
        AND u."is_active" = TRUE
      ORDER BY ai."verified_at" DESC, v."created_at" DESC, v."id" DESC
      LIMIT 1
    `);

    const source = result.rows[0];
    if (!source) {
      throw new ConflictException(
        'assignment snapshot details are unavailable',
      );
    }
    return source;
  }

  private formatFullName(source: AssignmentSnapshotSourceRow): string {
    return [source.first_name, source.middle_name, source.last_name]
      .filter((part): part is string => Boolean(part?.trim()))
      .map((part) => part.trim())
      .join(' ');
  }
}
