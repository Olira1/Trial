import {
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
} from '../dispatch-queue';
import {
  DispatchAssignmentPickupService,
  type DispatchPickupReminderJobData,
} from './dispatch-assignment-pickup.service';

export type DispatchPickupReminderJobResult = {
  status: 'warning_sent' | 'skipped' | 'rescheduled';
  pickupId: string;
};

@Injectable()
export class DispatchPickupReminderWorkerService implements OnModuleInit {
  private readonly logger = new Logger(
    DispatchPickupReminderWorkerService.name,
  );
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly pickup: DispatchAssignmentPickupService,
    private readonly queues: DispatchQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      DispatchPickupReminderJobData,
      DispatchPickupReminderJobResult
    >(DISPATCH_QUEUE_NAMES.pickupReminder, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Pickup reminder worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async processJob(
    job: Job<
      DispatchPickupReminderJobData,
      DispatchPickupReminderJobResult,
      string
    >,
  ): Promise<DispatchPickupReminderJobResult> {
    const { pickupId, warningDueAt } = job.data;

    this.logger.log(
      `Processing pickup reminder job pickupId=${pickupId} warningDueAt=${warningDueAt} jobId=${job.id}`,
    );

    try {
      await this.pickup.sendTripStartWarning(pickupId);
      return { status: 'warning_sent', pickupId };
    } catch (error) {
      if (error instanceof ConflictException) {
        const message = error.message;
        const dueAt = new Date(warningDueAt);

        if (message.includes('not due') && dueAt > new Date()) {
          await this.pickup.scheduleTripStartWarning(pickupId, dueAt);
          return { status: 'rescheduled', pickupId };
        }

        this.logger.warn(
          `Pickup reminder skipped pickupId=${pickupId}: ${message}`,
        );
        return { status: 'skipped', pickupId };
      }

      this.logger.error(
        `Pickup reminder failed pickupId=${pickupId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
