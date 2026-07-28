import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { desc, eq, inArray } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchQueueJobCounts,
  type DispatchQueueName,
  dispatchJobIds,
} from '../dispatch-queue';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { DISPATCH_RECONCILIATION_JOB_NAME } from './reconciliation-worker.service';
import { dispatchAttempt, dispatchOffer } from './schema';

export type DispatchQueueStatus = {
  queueName: DispatchQueueName;
  counts: DispatchQueueJobCounts;
};

export type DispatchFailedJob = {
  id: string;
  name: string;
  queueName: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
};

export type DispatchJobOperationResult = {
  success: boolean;
  jobId: string;
  queueName: string;
  message: string;
};

export type DispatchRequestInspection = {
  request: typeof rideRequest.$inferSelect;
  attempts: Array<typeof dispatchAttempt.$inferSelect>;
  offers: Array<typeof dispatchOffer.$inferSelect>;
  driverProfiles: Array<typeof driverOperationalProfile.$inferSelect>;
};

export type DispatchOfferInspection = {
  offer: typeof dispatchOffer.$inferSelect;
  request: typeof rideRequest.$inferSelect | null;
  attempt: typeof dispatchAttempt.$inferSelect | null;
  driverProfile: typeof driverOperationalProfile.$inferSelect | null;
};

export type DispatchDriverInspection = {
  driverProfile: typeof driverOperationalProfile.$inferSelect | null;
  offers: Array<typeof dispatchOffer.$inferSelect>;
  requests: Array<typeof rideRequest.$inferSelect>;
};

@Injectable()
export class DispatchJobOperationsService {
  private readonly logger = new Logger(DispatchJobOperationsService.name);

  constructor(
    private readonly queues: DispatchQueueService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async getAllQueueStatuses(): Promise<DispatchQueueStatus[]> {
    const queueNames = Object.values(DISPATCH_QUEUE_NAMES);
    const statuses: DispatchQueueStatus[] = [];

    for (const queueName of queueNames) {
      const counts = await this.queues.getJobCounts(queueName);
      statuses.push({ queueName, counts });
    }

    return statuses;
  }

  async getQueueStatus(
    queueName: DispatchQueueName,
  ): Promise<DispatchQueueStatus> {
    const counts = await this.queues.getJobCounts(queueName);
    return { queueName, counts };
  }

  async inspectRequest(
    requestId: string,
  ): Promise<DispatchRequestInspection | null> {
    const [request] = await this.db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId))
      .limit(1);

    if (!request) {
      return null;
    }

    const attempts = await this.db
      .select()
      .from(dispatchAttempt)
      .where(eq(dispatchAttempt.requestId, requestId))
      .orderBy(
        desc(dispatchAttempt.attemptNumber),
        desc(dispatchAttempt.createdAt),
      );

    const offers = await this.db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.requestId, requestId))
      .orderBy(desc(dispatchOffer.offeredAt), desc(dispatchOffer.createdAt));

    const driverIds = [...new Set(offers.map((offer) => offer.driverId))];
    const driverProfiles =
      driverIds.length === 0
        ? []
        : await this.db
            .select()
            .from(driverOperationalProfile)
            .where(inArray(driverOperationalProfile.userId, driverIds));

    return {
      request,
      attempts,
      offers,
      driverProfiles,
    };
  }

  async inspectOffer(offerId: string): Promise<DispatchOfferInspection | null> {
    const [offer] = await this.db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offerId))
      .limit(1);

    if (!offer) {
      return null;
    }

    const [request] = await this.db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, offer.requestId))
      .limit(1);
    const [attempt] = await this.db
      .select()
      .from(dispatchAttempt)
      .where(eq(dispatchAttempt.id, offer.attemptId))
      .limit(1);
    const [driverProfile] = await this.db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, offer.driverId))
      .limit(1);

    return {
      offer,
      request: request ?? null,
      attempt: attempt ?? null,
      driverProfile: driverProfile ?? null,
    };
  }

  async inspectDriver(driverId: string): Promise<DispatchDriverInspection> {
    const [profile] = await this.db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId))
      .limit(1);

    const offers = await this.db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.driverId, driverId))
      .orderBy(desc(dispatchOffer.offeredAt), desc(dispatchOffer.createdAt));

    const requestIds = [...new Set(offers.map((offer) => offer.requestId))];
    const requests =
      requestIds.length === 0
        ? []
        : await this.db
            .select()
            .from(rideRequest)
            .where(inArray(rideRequest.id, requestIds));

    return {
      driverProfile: profile ?? null,
      offers,
      requests,
    };
  }

  async enqueueReconciliation(
    actorUserId: string,
    reason: string,
  ): Promise<DispatchJobOperationResult> {
    const result = await this.queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
      jobName: DISPATCH_RECONCILIATION_JOB_NAME,
      jobId: dispatchJobIds.reconciliation({
        name: `manual-${actorUserId}`,
      }),
      data: {},
    });

    this.logger.log({
      msg: 'dispatch_admin_reconciliation_enqueued',
      actorUserId,
      reason,
      jobId: result.id,
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
    });

    return {
      success: true,
      jobId: result.id ?? '',
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
      message: 'dispatch reconciliation enqueued',
    };
  }
}
