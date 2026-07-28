import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { DBTransaction } from '../../database/database.module';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import {
  dispatchOffer,
  type DispatchOffer,
} from './schema/dispatch-offer.schema';

@Injectable()
export class OfferCancellationService {
  constructor(private readonly outbox: DispatchOutboxService) {}

  async cancelPendingOfferForRequest(
    tx: DBTransaction,
    requestId: string,
  ): Promise<DispatchOffer | null> {
    const [offer] = await tx
      .select()
      .from(dispatchOffer)
      .where(
        and(
          eq(dispatchOffer.requestId, requestId),
          eq(dispatchOffer.state, 'pending'),
        ),
      )
      .limit(1)
      .for('update');

    if (!offer) {
      return null;
    }

    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, offer.driverId))
      .limit(1)
      .for('update');

    if (!profile || profile.operationalState !== 'offered') {
      throw new ConflictException(
        `cannot cancel pending offer for driver in state ${profile?.operationalState ?? 'missing'}`,
      );
    }

    const now = new Date();
    const [cancelledOffer] = await tx
      .update(dispatchOffer)
      .set({
        state: 'cancelled',
        respondedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(dispatchOffer.id, offer.id), eq(dispatchOffer.state, 'pending')),
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
          eq(driverOperationalProfile.userId, offer.driverId),
          eq(driverOperationalProfile.operationalState, 'offered'),
        ),
      )
      .returning();

    if (!onlineProfile) {
      throw new ConflictException('driver release lost a race');
    }

    await this.outbox.append(tx, {
      eventKey: `dispatch_offer:${cancelledOffer.id}:cancelled`,
      eventType: 'dispatch_offer.cancelled.v1',
      aggregateType: 'dispatch_offer',
      aggregateId: cancelledOffer.id,
      correlationId: randomUUID(),
      actorUserId: cancelledOffer.driverId,
      payload: {
        offerId: cancelledOffer.id,
        requestId: cancelledOffer.requestId,
        attemptId: cancelledOffer.attemptId,
        driverId: cancelledOffer.driverId,
        respondedAt: now.toISOString(),
      },
    });

    return cancelledOffer;
  }
}
