import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
} from '../dispatch-queue';
import {
  DISPATCH_OUTBOX_PUBLISH_JOB_NAME,
  DispatchOutboxPublisherService,
  type DispatchOutboxPublishJobData,
  type DispatchOutboxPublishResult,
} from './dispatch-outbox-publisher.service';

@Injectable()
export class DispatchOutboxWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DispatchOutboxWorkerService.name);
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly queues: DispatchQueueService,
    private readonly publisher: DispatchOutboxPublisherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      DispatchOutboxPublishJobData,
      DispatchOutboxPublishResult
    >(DISPATCH_QUEUE_NAMES.outbox, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Dispatch outbox worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async processJob(
    job: Job<DispatchOutboxPublishJobData, DispatchOutboxPublishResult, string>,
  ): Promise<DispatchOutboxPublishResult> {
    if (job.name !== DISPATCH_OUTBOX_PUBLISH_JOB_NAME) {
      throw new Error(`unsupported dispatch outbox job ${job.name}`);
    }

    this.logger.debug(
      `Processing outbox publish job eventId=${job.data.outboxEventId} jobId=${job.id ?? 'unknown'}`,
    );
    return this.publisher.publishQueuedEvent(job.data.outboxEventId);
  }
}
