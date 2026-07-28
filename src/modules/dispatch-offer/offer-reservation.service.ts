import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, count, eq } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
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
import {
  DriverEligibilityService,
  DriverPresenceLeaseService,
  type DriverPresenceLeaseSnapshot,
  driverOperationalProfile,
} from '../driver-presence';
import type { RankedCandidate } from '../dispatch-candidate';
import { rideRequest } from '../ride-requests/schema';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import {
  dispatchOffer,
  type DispatchOffer,
} from './schema/dispatch-offer.schema';

export type ReservationResult =
  | { status: 'reserved'; offer: DispatchOffer }
  | { status: 'lost_race' }
  | { status: 'expired' };

@Injectable()
export class OfferReservationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly outbox: DispatchOutboxService,
    private readonly eligibility: DriverEligibilityService,
    private readonly leaseService: DriverPresenceLeaseService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async tryReserve(
    requestId: string,
    attemptId: string,
    candidate: RankedCandidate,
  ): Promise<ReservationResult> {
    if (
      this.config.internalDriverAllowlist.length > 0 &&
      !this.config.internalDriverAllowlist.includes(candidate.driverId)
    ) {
      return { status: 'lost_race' };
    }

    const lease = await this.leaseService.findCurrentLeaseByUserId(
      candidate.driverId,
    );
    if (!lease) {
      return { status: 'lost_race' };
    }

    return this.db.transaction(async (tx) =>
      this.tryReserveInTransaction(tx, requestId, attemptId, candidate, lease),
    );
  }

  async reserveWithExecutor(
    tx: DBTransaction,
    requestId: string,
    attemptId: string,
    candidate: RankedCandidate,
    lease: DriverPresenceLeaseSnapshot,
  ): Promise<ReservationResult> {
    return this.tryReserveInTransaction(
      tx,
      requestId,
      attemptId,
      candidate,
      lease,
    );
  }

  private async tryReserveInTransaction(
    tx: DBTransaction,
    requestId: string,
    attemptId: string,
    candidate: RankedCandidate,
    lease: DriverPresenceLeaseSnapshot,
  ): Promise<ReservationResult> {
    const [request] = await tx
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId))
      .limit(1)
      .for('update');

    if (!request || request.state !== 'searching') {
      return { status: 'lost_race' };
    }

    if (request.matchingDeadlineAt <= new Date()) {
      return { status: 'expired' };
    }

    const [attempt] = await tx
      .select()
      .from(dispatchAttempt)
      .where(
        and(
          eq(dispatchAttempt.id, attemptId),
          eq(dispatchAttempt.requestId, requestId),
          eq(dispatchAttempt.state, 'in_progress'),
        ),
      )
      .limit(1)
      .for('update');

    if (!attempt) {
      return { status: 'lost_race' };
    }

    const priorOfferCountResult = await tx
      .select({ value: count() })
      .from(dispatchOffer)
      .where(eq(dispatchOffer.requestId, requestId));
    const priorOfferCount = priorOfferCountResult[0]?.value ?? 0;

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, candidate.driverId))
      .limit(1)
      .for('update');

    if (!profile || profile.operationalState !== 'online') {
      return { status: 'lost_race' };
    }

    if (
      profile.ownerSessionId !== lease.ownerSessionId ||
      profile.presenceSessionId !== lease.presenceSessionId ||
      profile.presenceGeneration !== lease.presenceGeneration
    ) {
      return { status: 'lost_race' };
    }

    const eligibility =
      await this.eligibility.evaluateInstantRideDriverEligibility(
        candidate.driverId,
        tx,
      );
    if (!eligibility.eligible) {
      return { status: 'lost_race' };
    }

    const now = new Date();
    await tx
      .update(driverOperationalProfile)
      .set({ operationalState: 'offered', updatedAt: now })
      .where(eq(driverOperationalProfile.userId, candidate.driverId));

    const expiresAt = new Date(now.getTime() + request.offerTtlSeconds * 1_000);

    const [offer] = await tx
      .insert(dispatchOffer)
      .values({
        requestId,
        attemptId,
        driverId: candidate.driverId,
        state: 'pending',
        offeredAt: now,
        expiresAt,
        etaSeconds: candidate.etaSeconds,
        distanceMeters: candidate.distanceMeters,
      })
      .returning();

    if (!offer) {
      throw new Error('dispatch offer insert returned no row');
    }

    const [updated] = await tx
      .update(rideRequest)
      .set({ state: 'offered', updatedAt: now })
      .where(
        and(eq(rideRequest.id, requestId), eq(rideRequest.state, 'searching')),
      )
      .returning();

    if (!updated) {
      throw new Error('ride request offer state update returned no row');
    }

    this.metrics.recordOfferCreated(requestId, offer.id, candidate.driverId);
    if (priorOfferCount === 0) {
      this.metrics.recordTimeToFirstOffer(
        requestId,
        now.getTime() - request.createdAt.getTime(),
      );
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${offer.id}:created`,
      eventType: 'dispatch_offer.created.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: offer.id,
      correlationId: randomUUID(),
      actorUserId: candidate.driverId,
      payload: {
        offerId: offer.id,
        requestId,
        attemptId,
        driverId: candidate.driverId,
        etaSeconds: candidate.etaSeconds,
        distanceMeters: candidate.distanceMeters,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return { status: 'reserved', offer };
  }
}
