import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
import {
  dispatchOffer,
  type DispatchOffer,
} from './schema/dispatch-offer.schema';

@Injectable()
export class OfferExpirationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: DispatchOutboxService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async expire(offerId: string): Promise<DispatchOffer> {
    return this.db.transaction((tx) => this.expireInTransaction(tx, offerId));
  }

  private async expireInTransaction(
    tx: DBTransaction,
    offerId: string,
  ): Promise<DispatchOffer> {
    const [offer] = await tx
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offerId))
      .limit(1)
      .for('update');

    if (!offer) {
      throw new ConflictException('dispatch offer not found');
    }

    if (offer.state === 'expired') {
      return offer;
    }

    if (offer.state !== 'pending') {
      throw new ConflictException(
        `cannot expire offer in state ${offer.state}`,
      );
    }

    const now = new Date();
    if (offer.expiresAt > now) {
      throw new ConflictException('cannot expire a non-overdue offer');
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
      .where(eq(driverOperationalProfile.userId, offer.driverId))
      .limit(1)
      .for('update');

    if (!request || request.state !== 'offered') {
      throw new ConflictException(
        `cannot expire offer for request in state ${request?.state ?? 'missing'}`,
      );
    }

    if (!profile || profile.operationalState !== 'offered') {
      throw new ConflictException(
        `cannot expire offer for driver in state ${profile?.operationalState ?? 'missing'}`,
      );
    }

    const [expiredOffer] = await tx
      .update(dispatchOffer)
      .set({
        state: 'expired',
        respondedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(dispatchOffer.id, offerId), eq(dispatchOffer.state, 'pending')),
      )
      .returning();

    if (!expiredOffer) {
      throw new ConflictException('offer expiration lost a race');
    }

    const [searchingRequest] = await tx
      .update(rideRequest)
      .set({ state: 'searching', updatedAt: now })
      .where(
        and(
          eq(rideRequest.id, offer.requestId),
          eq(rideRequest.state, 'offered'),
        ),
      )
      .returning();

    if (!searchingRequest) {
      throw new ConflictException('request retry transition lost a race');
    }

    const [onlineProfile] = await tx
      .update(driverOperationalProfile)
      .set({ operationalState: 'online', updatedAt: now })
      .where(
        and(
          eq(driverOperationalProfile.userId, offer.driverId),
          eq(driverOperationalProfile.operationalState, 'offered'),
        ),
      )
      .returning();

    if (!onlineProfile) {
      throw new ConflictException('driver release lost a race');
    }

    this.metrics.recordOfferExpired(
      offer.requestId,
      expiredOffer.id,
      offer.driverId,
    );

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${expiredOffer.id}:expired`,
      eventType: 'dispatch_offer.expired.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: expiredOffer.id,
      correlationId: randomUUID(),
      actorUserId: expiredOffer.driverId,
      payload: {
        offerId: expiredOffer.id,
        requestId: expiredOffer.requestId,
        attemptId: expiredOffer.attemptId,
        driverId: expiredOffer.driverId,
        respondedAt: now.toISOString(),
        requestState: 'searching',
        rematchRequired: true,
      },
    });

    return expiredOffer;
  }
}
