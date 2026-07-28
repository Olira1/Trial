import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
  dispatchJobIds,
} from '../dispatch-queue';
import { NotificationsService } from '../notifications';

export const DISPATCH_NOTIFICATION_JOB_NAME = 'dispatch.notification.deliver';

export type DispatchNotificationJobData = {
  outboxEventId: string;
  eventType: string;
  driverId?: string;
  riderId?: string;
  payload: Record<string, unknown>;
};

export type DispatchNotificationJobResult = {
  status: 'sent' | 'skipped' | 'no_tokens';
  outboxEventId: string;
};

@Injectable()
export class DispatchNotificationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(DispatchNotificationWorkerService.name);
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly queues: DispatchQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      DispatchNotificationJobData,
      DispatchNotificationJobResult
    >(DISPATCH_QUEUE_NAMES.notification, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Dispatch notification worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async enqueueNotificationJob(
    data: DispatchNotificationJobData,
  ): Promise<{ id: string | undefined; name: string }> {
    return this.queues.enqueue<DispatchNotificationJobData>({
      queueName: DISPATCH_QUEUE_NAMES.notification,
      jobName: DISPATCH_NOTIFICATION_JOB_NAME,
      jobId: dispatchJobIds.notification({
        outboxEventId: data.outboxEventId,
        channel: 'fcm',
      }),
      data,
    });
  }

  private async processJob(
    job: Job<
      DispatchNotificationJobData,
      DispatchNotificationJobResult,
      string
    >,
  ): Promise<DispatchNotificationJobResult> {
    const { outboxEventId, eventType, driverId, payload } = job.data;

    this.logger.log(
      `Processing notification job outboxEventId=${outboxEventId} eventType=${eventType} jobId=${job.id}`,
    );

    const content = this.resolveNotificationContent(eventType, payload);
    if (!content) {
      this.logger.log(
        `No notification mapping for eventType=${eventType}, skipping`,
      );
      return { status: 'skipped', outboxEventId };
    }

    if (!driverId) {
      this.logger.warn(
        `Notification job outboxEventId=${outboxEventId} missing driverId, skipping`,
      );
      return { status: 'skipped', outboxEventId };
    }

    try {
      await this.notifications.sendUserNotification(driverId, content);

      this.logger.log(
        `Notification delivered outboxEventId=${outboxEventId} driverId=${driverId}`,
      );
      return { status: 'sent', outboxEventId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('not found') || message.includes('No active')) {
        this.logger.warn(
          `Notification skipped outboxEventId=${outboxEventId} driverId=${driverId}: ${message}`,
        );
        return { status: 'no_tokens', outboxEventId };
      }

      this.logger.error(
        `Notification failed outboxEventId=${outboxEventId} driverId=${driverId}: ${message}`,
      );
      throw error;
    }
  }

  private resolveNotificationContent(
    eventType: string,
    payload: Record<string, unknown>,
  ): { title: string; body: string } | null {
    switch (eventType) {
      case 'dispatch_offer.created.v1':
        return {
          title: 'New ride offer',
          body: `You have a new ride offer. ETA: ${typeof payload.etaSeconds === 'number' ? payload.etaSeconds : 'N/A'}s`,
        };
      case 'dispatch_offer.cancelled.v1':
        return {
          title: 'Ride offer cancelled',
          body: 'Your ride offer has been cancelled by the rider.',
        };
      case 'dispatch_offer.expired.v1':
        return null;
      case 'dispatch_offer.accepted.v1':
        return null;
      case 'dispatch_offer.rejected.v1':
        return null;
      default:
        return null;
    }
  }
}
