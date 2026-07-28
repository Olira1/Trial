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
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  dispatchJobIds,
} from '../dispatch-queue';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { dispatchAssignmentPickup } from './schema/dispatch-assignment-pickup.schema';
import { dispatchAssignmentTrip } from './schema/dispatch-assignment-trip.schema';
import { dispatchAssignment } from './schema/dispatch-assignment.schema';
import { dispatchCancellation } from './schema/dispatch-cancellation.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

// TODO(D10.4): Move pickup wait policy to dispatch configuration once product confirms the value.
const PICKUP_WAIT_MS = 60_000;
export const DISPATCH_PICKUP_REMINDER_JOB_NAME =
  'dispatch.pickup-reminder.warn';

export type DispatchPickupReminderJobData = {
  pickupId: string;
  warningDueAt: string;
};

type AssignmentForPickup = {
  id: string;
  requestId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  offerState: typeof dispatchOffer.$inferSelect.state;
  requestState: typeof rideRequest.$inferSelect.state;
};

export type DispatchAssignmentPickupControl =
  typeof dispatchAssignmentPickup.$inferSelect;

@Injectable()
export class DispatchAssignmentPickupService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: DispatchOutboxService,
    private readonly queues: DispatchQueueService,
  ) {}

  async arriveAtPickup(
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    const pickup = await this.db.transaction((tx) =>
      this.arriveAtPickupInTransaction(tx, driverId, assignmentId),
    );

    await this.scheduleTripStartWarning(pickup.id, pickup.warningDueAt);

    return pickup;
  }

  async sendTripStartWarning(
    pickupId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    return this.db.transaction((tx) =>
      this.sendTripStartWarningInTransaction(tx, pickupId),
    );
  }

  async cancelRiderNoShow(
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    return this.db.transaction((tx) =>
      this.cancelRiderNoShowInTransaction(tx, driverId, assignmentId),
    );
  }

  async scheduleTripStartWarning(
    pickupId: string,
    warningDueAt: Date,
  ): Promise<{ id: string | undefined; name: string }> {
    const delayMs = Math.max(0, warningDueAt.getTime() - Date.now());

    return this.queues.enqueue<DispatchPickupReminderJobData>({
      queueName: DISPATCH_QUEUE_NAMES.pickupReminder,
      jobName: DISPATCH_PICKUP_REMINDER_JOB_NAME,
      jobId: dispatchJobIds.pickupReminder({ pickupId, warningDueAt }),
      data: {
        pickupId,
        warningDueAt: warningDueAt.toISOString(),
      },
      delayMs,
    });
  }

  private async arriveAtPickupInTransaction(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    const assignment = await this.loadAssignmentForPickup(
      tx,
      driverId,
      assignmentId,
    );

    const [existing] = await tx
      .select()
      .from(dispatchAssignmentPickup)
      .where(eq(dispatchAssignmentPickup.assignmentId, assignmentId))
      .limit(1)
      .for('update');

    if (existing) {
      return existing;
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + PICKUP_WAIT_MS);

    const [created] = await tx
      .insert(dispatchAssignmentPickup)
      .values({
        assignmentId,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId: assignment.driverId,
        state: 'arrived',
        arrivedAt: now,
        warningDueAt: dueAt,
        noShowCancellableAt: dueAt,
      })
      .onConflictDoNothing({
        target: dispatchAssignmentPickup.assignmentId,
      })
      .returning();

    if (!created) {
      const [racedExisting] = await tx
        .select()
        .from(dispatchAssignmentPickup)
        .where(eq(dispatchAssignmentPickup.assignmentId, assignmentId))
        .limit(1);

      if (!racedExisting) {
        throw new ConflictException('pickup arrival lost a race');
      }

      return racedExisting;
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignmentId}:pickup_arrived`,
      eventType: 'dispatch_assignment.pickup_arrived.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignmentId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        pickupId: created.id,
        assignmentId,
        requestId: created.requestId,
        offerId: created.offerId,
        riderId: created.riderId,
        driverId,
        arrivedAt: created.arrivedAt.toISOString(),
        warningDueAt: created.warningDueAt.toISOString(),
        noShowCancellableAt: created.noShowCancellableAt.toISOString(),
      },
    });

    return created;
  }

  private async sendTripStartWarningInTransaction(
    tx: DBTransaction,
    pickupId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    const [pickup] = await tx
      .select()
      .from(dispatchAssignmentPickup)
      .where(eq(dispatchAssignmentPickup.id, pickupId))
      .limit(1)
      .for('update');

    if (!pickup) {
      throw new NotFoundException('dispatch assignment pickup not found');
    }

    if (pickup.noShowCancelledAt) {
      throw new ConflictException('pickup is already cancelled');
    }

    if (pickup.warningSentAt) {
      return pickup;
    }

    const now = new Date();
    if (pickup.warningDueAt > now) {
      throw new ConflictException('trip-start warning is not due');
    }

    const [trip] = await tx
      .select({ id: dispatchAssignmentTrip.id })
      .from(dispatchAssignmentTrip)
      .where(eq(dispatchAssignmentTrip.assignmentId, pickup.assignmentId))
      .limit(1)
      .for('update');

    if (trip) {
      return pickup;
    }

    const [updated] = await tx
      .update(dispatchAssignmentPickup)
      .set({
        state: 'warning_sent',
        warningSentAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(dispatchAssignmentPickup.id, pickupId),
          eq(dispatchAssignmentPickup.state, pickup.state),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictException('trip-start warning lost a race');
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${updated.assignmentId}:trip_start_warning`,
      eventType: 'dispatch_assignment.trip_start_warning.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: updated.assignmentId,
      correlationId: randomUUID(),
      actorUserId: updated.driverId,
      payload: {
        pickupId: updated.id,
        assignmentId: updated.assignmentId,
        requestId: updated.requestId,
        offerId: updated.offerId,
        riderId: updated.riderId,
        driverId: updated.driverId,
        arrivedAt: updated.arrivedAt.toISOString(),
        warningDueAt: updated.warningDueAt.toISOString(),
        warningSentAt: updated.warningSentAt?.toISOString() ?? null,
      },
    });

    return updated;
  }

  private async cancelRiderNoShowInTransaction(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<DispatchAssignmentPickupControl> {
    const [pickup] = await tx
      .select()
      .from(dispatchAssignmentPickup)
      .where(
        and(
          eq(dispatchAssignmentPickup.assignmentId, assignmentId),
          eq(dispatchAssignmentPickup.driverId, driverId),
        ),
      )
      .limit(1)
      .for('update');

    if (!pickup) {
      throw new NotFoundException('dispatch assignment pickup not found');
    }

    if (pickup.noShowCancelledAt) {
      return pickup;
    }

    const now = new Date();
    if (pickup.noShowCancellableAt > now) {
      throw new ConflictException('rider no-show cancellation is not due');
    }

    const [request] = await tx
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, pickup.requestId))
      .limit(1)
      .for('update');
    const [offer] = await tx
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, pickup.offerId))
      .limit(1)
      .for('update');
    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1)
      .for('update');

    if (!request || request.state !== 'assigned') {
      throw new ConflictException('request is not active for no-show');
    }

    if (!offer || offer.state !== 'accepted') {
      throw new ConflictException('offer is not active for no-show');
    }

    if (!profile || profile.operationalState !== 'assigned') {
      throw new ConflictException(
        `driver is not assigned for no-show cancellation`,
      );
    }

    const [cancelledPickup] = await tx
      .update(dispatchAssignmentPickup)
      .set({
        state: 'rider_no_show_cancelled',
        noShowCancelledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(dispatchAssignmentPickup.id, pickup.id),
          eq(dispatchAssignmentPickup.state, pickup.state),
        ),
      )
      .returning();

    if (!cancelledPickup) {
      throw new ConflictException('rider no-show cancellation lost a race');
    }

    const [cancelledRequest] = await tx
      .update(rideRequest)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(rideRequest.id, pickup.requestId),
          eq(rideRequest.state, 'assigned'),
        ),
      )
      .returning();

    if (!cancelledRequest) {
      throw new ConflictException('request no-show cancellation lost a race');
    }

    const [cancelledOffer] = await tx
      .update(dispatchOffer)
      .set({ state: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(dispatchOffer.id, pickup.offerId),
          eq(dispatchOffer.state, 'accepted'),
        ),
      )
      .returning();

    if (!cancelledOffer) {
      throw new ConflictException('offer no-show cancellation lost a race');
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
      throw new ConflictException('driver no-show release lost a race');
    }

    const [createdCancellation] = await tx
      .insert(dispatchCancellation)
      .values({
        requestId: cancelledRequest.id,
        offerId: cancelledOffer.id,
        assignmentId,
        actorUserId: driverId,
        actorRole: 'driver',
        reasonCode: 'rider_no_show',
        notes: null,
      })
      .onConflictDoNothing({
        target: dispatchCancellation.requestId,
      })
      .returning();

    const cancellation =
      createdCancellation ??
      (
        await tx
          .select()
          .from(dispatchCancellation)
          .where(eq(dispatchCancellation.requestId, cancelledRequest.id))
          .limit(1)
          .for('update')
      )[0];

    if (!cancellation) {
      throw new ConflictException(
        'rider no-show cancellation audit lost a race',
      );
    }

    const payloadCancellation = {
      id: cancellation.id,
      actorRole: cancellation.actorRole,
      reasonCode: cancellation.reasonCode,
      notes: cancellation.notes,
    };

    await this.outbox.append(tx, {
      eventKey: `dispatch_assignment:${assignmentId}:rider_no_show_cancelled`,
      eventType: 'dispatch_assignment.rider_no_show_cancelled.v1',
      aggregateType: 'dispatch_assignment',
      aggregateId: assignmentId,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        pickupId: cancelledPickup.id,
        assignmentId,
        requestId: cancelledPickup.requestId,
        offerId: cancelledPickup.offerId,
        riderId: cancelledPickup.riderId,
        driverId,
        noShowCancelledAt: now.toISOString(),
        cancellation: payloadCancellation,
      },
    });

    await this.outbox.append(tx, {
      eventKey: `ride_request:${cancelledRequest.id}:cancelled`,
      eventType: 'ride_request.cancelled.v1',
      aggregateType: 'ride_request',
      aggregateId: cancelledRequest.id,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        requestId: cancelledRequest.id,
        riderId: cancelledRequest.riderId,
        state: 'cancelled',
        reason: 'rider_no_show',
        cancellation: payloadCancellation,
      },
    });

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${cancelledOffer.id}:cancelled`,
      eventType: 'dispatch_offer.cancelled.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: cancelledOffer.id,
      correlationId: randomUUID(),
      actorUserId: driverId,
      payload: {
        offerId: cancelledOffer.id,
        requestId: cancelledOffer.requestId,
        attemptId: cancelledOffer.attemptId,
        driverId,
        respondedAt: now.toISOString(),
        reason: 'rider_no_show',
        cancellation: payloadCancellation,
      },
    });

    return cancelledPickup;
  }

  private async loadAssignmentForPickup(
    tx: DBTransaction,
    driverId: string,
    assignmentId: string,
  ): Promise<AssignmentForPickup> {
    const [row] = await tx
      .select({
        id: dispatchAssignment.id,
        requestId: dispatchAssignment.requestId,
        offerId: dispatchAssignment.offerId,
        riderId: dispatchAssignment.riderId,
        driverId: dispatchAssignment.driverId,
        offerState: dispatchOffer.state,
        requestState: rideRequest.state,
      })
      .from(dispatchAssignment)
      .innerJoin(
        dispatchOffer,
        eq(dispatchOffer.id, dispatchAssignment.offerId),
      )
      .innerJoin(rideRequest, eq(rideRequest.id, dispatchAssignment.requestId))
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

    if (row.offerState !== 'accepted' || row.requestState !== 'assigned') {
      throw new ConflictException('assignment is not active for pickup');
    }

    return row;
  }
}
