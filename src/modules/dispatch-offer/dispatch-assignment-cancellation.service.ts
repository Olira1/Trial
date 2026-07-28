import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import {
  type DispatchCancellationInput,
  type DispatchCancellationReasonCode,
} from './dispatch-cancellation.types';
import { dispatchAssignment } from './schema/dispatch-assignment.schema';
import {
  dispatchCancellation,
  type DispatchCancellation,
} from './schema/dispatch-cancellation.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

type AssignmentForCancellation = {
  id: string;
  requestId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  requestState: typeof rideRequest.$inferSelect.state;
  offerState: typeof dispatchOffer.$inferSelect.state;
};

type NormalizedAssignmentCancellation = {
  actorRole: 'driver';
  reasonCode: DispatchCancellationReasonCode;
  notes: string | null;
};

@Injectable()
export class DispatchAssignmentCancellationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: DispatchOutboxService,
  ) {}

  async cancelAssignedRide(
    driverId: string,
    assignmentId: string,
    input: DispatchCancellationInput = {},
  ): Promise<DispatchCancellation> {
    const cancellation = this.normalizeDriverCancellation(input);

    return this.db.transaction((tx) =>
      this.cancelAssignedRideInTransaction(
        tx,
        driverId,
        assignmentId,
        cancellation,
      ),
    );
  }

  private async cancelAssignedRideInTransaction(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
    cancellation: NormalizedAssignmentCancellation,
  ): Promise<DispatchCancellation> {
    const assignment = await this.loadAssignmentForCancellation(
      tx,
      driverId,
      assignmentId,
    );

    const existingCancellation = await this.findExistingCancellation(
      tx,
      assignment.requestId,
    );
    if (existingCancellation) {
      return existingCancellation;
    }

    if (
      assignment.requestState !== 'assigned' ||
      assignment.offerState !== 'accepted'
    ) {
      throw new ConflictException('assignment is not active for cancellation');
    }

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1)
      .for('update');

    if (!profile || profile.operationalState !== 'assigned') {
      throw new ConflictException('driver is not assigned for cancellation');
    }

    const now = new Date();
    const [createdCancellation] = await tx
      .insert(dispatchCancellation)
      .values({
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        assignmentId,
        actorUserId: driverId,
        actorRole: cancellation.actorRole,
        reasonCode: cancellation.reasonCode,
        notes: cancellation.notes,
      })
      .onConflictDoNothing({
        target: dispatchCancellation.requestId,
      })
      .returning();

    if (!createdCancellation) {
      const existing = await this.findExistingCancellation(
        tx,
        assignment.requestId,
      );
      if (existing) return existing;
      throw new ConflictException('assignment cancellation lost a race');
    }

    const [cancelledRequest] = await tx
      .update(rideRequest)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(rideRequest.id, assignment.requestId),
          eq(rideRequest.state, 'assigned'),
        ),
      )
      .returning();

    if (!cancelledRequest) {
      throw new ConflictException('request cancellation lost a race');
    }

    const [cancelledOffer] = await tx
      .update(dispatchOffer)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(dispatchOffer.id, assignment.offerId),
          eq(dispatchOffer.state, 'accepted'),
        ),
      )
      .returning();

    if (!cancelledOffer) {
      throw new ConflictException('offer cancellation lost a race');
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

    const payloadCancellation = {
      id: createdCancellation.id,
      actorRole: cancellation.actorRole,
      reasonCode: cancellation.reasonCode,
      notes: cancellation.notes,
    };

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignmentId}:cancelled`,
      eventType: 'dispatch_assignment.cancelled.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignmentId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        assignmentId,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId,
        state: 'cancelled',
        cancelledAt: now.toISOString(),
        cancellation: payloadCancellation,
      },
    });

    await this.outbox.append(tx, {
      eventKey: `ride_request:${assignment.requestId}:cancelled`,
      eventType: 'ride_request.cancelled.v1',
      aggregateType: 'ride_request',
      aggregateId: assignment.requestId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        requestId: assignment.requestId,
        riderId: assignment.riderId,
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
      actorUserId: driverId,
      payload: {
        offerId: assignment.offerId,
        requestId: assignment.requestId,
        driverId,
        state: 'cancelled',
        cancelledAt: now.toISOString(),
        cancellation: payloadCancellation,
      },
    });

    return createdCancellation;
  }

  private normalizeDriverCancellation(
    input: DispatchCancellationInput,
  ): NormalizedAssignmentCancellation {
    const notes = input.notes?.trim();

    return {
      actorRole: 'driver',
      reasonCode: input.reasonCode ?? 'generic',
      notes: notes && notes.length > 0 ? notes : null,
    };
  }

  private async loadAssignmentForCancellation(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<AssignmentForCancellation> {
    const [row] = await tx
      .select({
        id: dispatchAssignment.id,
        requestId: dispatchAssignment.requestId,
        offerId: dispatchAssignment.offerId,
        riderId: dispatchAssignment.riderId,
        driverId: dispatchAssignment.driverId,
        requestState: rideRequest.state,
        offerState: dispatchOffer.state,
      })
      .from(dispatchAssignment)
      .innerJoin(rideRequest, eq(rideRequest.id, dispatchAssignment.requestId))
      .innerJoin(
        dispatchOffer,
        eq(dispatchOffer.id, dispatchAssignment.offerId),
      )
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

  private async findExistingCancellation(
    tx: DBTransaction,
    requestId: string,
  ): Promise<DispatchCancellation | null> {
    const [existing] = await tx
      .select()
      .from(dispatchCancellation)
      .where(eq(dispatchCancellation.requestId, requestId))
      .limit(1)
      .for('update');

    return existing ?? null;
  }
}
