import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_METRICS,
  NOOP_DISPATCH_METRICS,
  type DispatchMetrics,
} from '../dispatch-candidate';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
  dispatchJobIds,
} from '../dispatch-queue';
import { DispatchOutboxPublisherService } from '../dispatch-outbox';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';
import { MatchWorkerService } from './match-worker.service';
import { dispatchOffer } from './schema/dispatch-offer.schema';

export const DISPATCH_RECONCILIATION_JOB_NAME = 'dispatch.reconciliation.run';

export type DispatchReconciliationJobResult = {
  status: 'completed';
  checks: {
    staleOfferedRequests: number;
    staleOfferedDrivers: number;
    expiredOffersRecovered: number;
    searchingRequestsRequeued: number;
    unpublishedOutboxEvents: number;
  };
};

@Injectable()
export class ReconciliationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationWorkerService.name);
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly queues: DispatchQueueService,
    private readonly expirationWorker: OfferExpirationWorkerService,
    private readonly matchWorker: MatchWorkerService,
    private readonly outboxPublisher: DispatchOutboxPublisherService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      Record<string, never>,
      DispatchReconciliationJobResult
    >(DISPATCH_QUEUE_NAMES.reconciliation, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Reconciliation worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async enqueueReconciliationJob(): Promise<{
    id: string | undefined;
    name: string;
  }> {
    return this.queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
      jobName: DISPATCH_RECONCILIATION_JOB_NAME,
      jobId: dispatchJobIds.reconciliation({ name: 'periodic' }),
      data: {},
    });
  }

  async runChecks(): Promise<DispatchReconciliationJobResult> {
    const staleOfferedRequests = await this.repairStaleOfferedRequests();
    const staleOfferedDrivers = await this.repairStaleOfferedDrivers();
    const expiredOffersRecovered =
      await this.expirationWorker.recoverMissingJobs();
    const searchingRequestsRequeued =
      await this.requeueSearchingRequestsWithoutWork();
    const unpublishedResults =
      await this.outboxPublisher.enqueuePendingPublishJobs({ limit: 100 });
    const outboxHealth = await this.loadOutboxHealth();

    this.metrics.recordOutboxUnpublished(
      outboxHealth.count,
      outboxHealth.oldestAgeMs,
    );
    this.metrics.recordPresenceReconciliation(
      staleOfferedRequests +
        staleOfferedDrivers +
        expiredOffersRecovered +
        searchingRequestsRequeued,
    );

    const result: DispatchReconciliationJobResult = {
      status: 'completed',
      checks: {
        staleOfferedRequests,
        staleOfferedDrivers,
        expiredOffersRecovered,
        searchingRequestsRequeued,
        unpublishedOutboxEvents: unpublishedResults.length,
      },
    };

    this.logger.log(
      `Reconciliation completed: ${JSON.stringify(result.checks)}`,
    );
    return result;
  }

  private async loadOutboxHealth(): Promise<{
    count: number;
    oldestAgeMs: number;
  }> {
    const result = await this.db.execute<{
      count: number;
      oldest_age_ms: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN("created_at"))) * 1000,
          0
        )::int AS oldest_age_ms
      FROM "dispatch_outbox_event"
      WHERE "published_at" IS NULL
    `);

    const row = result.rows[0];
    return {
      count: row?.count ?? 0,
      oldestAgeMs: row?.oldest_age_ms ?? 0,
    };
  }

  private async processJob(
    _job: Job<Record<string, never>, DispatchReconciliationJobResult, string>,
  ): Promise<DispatchReconciliationJobResult> {
    this.logger.log('Running reconciliation checks');
    return this.runChecks();
  }

  private async repairStaleOfferedRequests(): Promise<number> {
    const staleRequests = await this.db
      .select({ id: rideRequest.id, updatedAt: rideRequest.updatedAt })
      .from(rideRequest)
      .where(eq(rideRequest.state, 'offered'));

    let repaired = 0;
    for (const request of staleRequests) {
      this.metrics.recordStuckRequest(
        request.id,
        'offered',
        Date.now() - request.updatedAt.getTime(),
      );
      const [pendingOffer] = await this.db
        .select({ id: dispatchOffer.id })
        .from(dispatchOffer)
        .where(
          and(
            eq(dispatchOffer.requestId, request.id),
            eq(dispatchOffer.state, 'pending'),
          ),
        )
        .limit(1);

      if (!pendingOffer) {
        const [updated] = await this.db
          .update(rideRequest)
          .set({ state: 'searching', updatedAt: new Date() })
          .where(
            and(
              eq(rideRequest.id, request.id),
              eq(rideRequest.state, 'offered'),
            ),
          )
          .returning();

        if (updated) {
          repaired++;
          this.logger.warn(
            `Repaired stale offered request requestId=${request.id}: moved to searching`,
          );
        }
      }
    }

    return repaired;
  }

  private async requeueSearchingRequestsWithoutWork(): Promise<number> {
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT "rr"."id"
      FROM "ride_request" AS "rr"
      WHERE "rr"."state" = 'searching'
        AND NOT EXISTS (
          SELECT 1
          FROM "dispatch_attempt" AS "da"
          WHERE "da"."request_id" = "rr"."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "dispatch_offer" AS "do"
          WHERE "do"."request_id" = "rr"."id"
        )
      ORDER BY "rr"."created_at" ASC
      LIMIT 100
    `);

    let requeued = 0;
    for (const request of result.rows) {
      const attemptId = `recovery-${Date.now()}-${requeued + 1}`;
      try {
        await this.matchWorker.enqueueMatchJob(request.id, attemptId);
        requeued++;
        this.logger.warn(
          `Requeued searching request without match work requestId=${request.id} attemptId=${attemptId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to requeue searching request without match work requestId=${request.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return requeued;
  }

  private async repairStaleOfferedDrivers(): Promise<number> {
    const staleDrivers = await this.db
      .select({
        userId: driverOperationalProfile.userId,
        updatedAt: driverOperationalProfile.updatedAt,
      })
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.operationalState, 'offered'));

    let repaired = 0;
    for (const driver of staleDrivers) {
      this.metrics.recordStuckDriver(
        driver.userId,
        'offered',
        Date.now() - driver.updatedAt.getTime(),
      );
      const [pendingOffer] = await this.db
        .select({ id: dispatchOffer.id })
        .from(dispatchOffer)
        .where(
          and(
            eq(dispatchOffer.driverId, driver.userId),
            eq(dispatchOffer.state, 'pending'),
          ),
        )
        .limit(1);

      if (!pendingOffer) {
        const [updated] = await this.db
          .update(driverOperationalProfile)
          .set({ operationalState: 'online', updatedAt: new Date() })
          .where(
            and(
              eq(driverOperationalProfile.userId, driver.userId),
              eq(driverOperationalProfile.operationalState, 'offered'),
            ),
          )
          .returning();

        if (updated) {
          repaired++;
          this.logger.warn(
            `Repaired stale offered driver driverId=${driver.userId}: moved to online`,
          );
        }
      }
    }

    return repaired;
  }
}
