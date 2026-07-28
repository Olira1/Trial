import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, eq, lte } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
  dispatchJobIds,
} from '../dispatch-queue';
import { OfferExpirationService } from './offer-expiration.service';
import { dispatchOffer } from './schema/dispatch-offer.schema';

export const DISPATCH_OFFER_EXPIRATION_JOB_NAME =
  'dispatch.offer-expiration.expire';

export type DispatchOfferExpirationJobData = {
  offerId: string;
  expiresAt: string;
};

export type DispatchOfferExpirationJobResult = {
  status: 'expired' | 'skipped' | 'rescheduled';
  offerId: string;
};

@Injectable()
export class OfferExpirationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(OfferExpirationWorkerService.name);
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly expiration: OfferExpirationService,
    private readonly queues: DispatchQueueService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      DispatchOfferExpirationJobData,
      DispatchOfferExpirationJobResult
    >(DISPATCH_QUEUE_NAMES.offerExpiration, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Offer expiration worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async scheduleExpiration(
    offerId: string,
    expiresAt: Date,
  ): Promise<{ id: string | undefined; name: string }> {
    const delayMs = Math.max(0, expiresAt.getTime() - Date.now());

    return this.queues.enqueue<DispatchOfferExpirationJobData>({
      queueName: DISPATCH_QUEUE_NAMES.offerExpiration,
      jobName: DISPATCH_OFFER_EXPIRATION_JOB_NAME,
      jobId: dispatchJobIds.offerExpiration({ offerId, expiresAt }),
      data: { offerId, expiresAt: expiresAt.toISOString() },
      delayMs,
    });
  }

  async recoverMissingJobs(): Promise<number> {
    const overdueOffers = await this.db
      .select({
        id: dispatchOffer.id,
        expiresAt: dispatchOffer.expiresAt,
      })
      .from(dispatchOffer)
      .where(
        and(
          eq(dispatchOffer.state, 'pending'),
          lte(dispatchOffer.expiresAt, new Date()),
        ),
      );

    let recovered = 0;
    for (const offer of overdueOffers) {
      await this.scheduleExpiration(offer.id, offer.expiresAt);
      recovered++;
    }

    if (recovered > 0) {
      this.logger.log(`Recovered ${recovered} missing expiration jobs`);
    }

    return recovered;
  }

  private async processJob(
    job: Job<
      DispatchOfferExpirationJobData,
      DispatchOfferExpirationJobResult,
      string
    >,
  ): Promise<DispatchOfferExpirationJobResult> {
    const { offerId, expiresAt } = job.data;

    this.logger.log(
      `Processing expiration job offerId=${offerId} expiresAt=${expiresAt} jobId=${job.id}`,
    );

    try {
      await this.expiration.expire(offerId);

      this.logger.log(`Offer expired offerId=${offerId}`);
      return { status: 'expired', offerId };
    } catch (error) {
      if (error instanceof ConflictException) {
        const message = error.message;

        if (message.includes('not found')) {
          this.logger.warn(
            `Expiration job skipped offerId=${offerId}: offer not found`,
          );
          return { status: 'skipped', offerId };
        }

        if (message.includes('non-overdue')) {
          const expiresAtDate = new Date(expiresAt);
          if (expiresAtDate > new Date()) {
            await this.scheduleExpiration(offerId, expiresAtDate);
            this.logger.log(
              `Rescheduled expiration job offerId=${offerId} for ${expiresAt}`,
            );
            return { status: 'rescheduled', offerId };
          }
        }

        this.logger.warn(
          `Expiration job skipped offerId=${offerId}: ${message}`,
        );
        return { status: 'skipped', offerId };
      }

      this.logger.error(
        `Expiration job failed offerId=${offerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
