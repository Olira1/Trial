import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  dispatchJobIds,
} from '../dispatch-queue';
import { DispatchEventPublisher } from '../dispatch-realtime/dispatch-event-publisher.service';
import { dispatchOutboxEvent } from './schema';

export const DISPATCH_OUTBOX_PUBLISH_JOB_NAME = 'dispatch.outbox.publish';

export type DispatchOutboxPublishJobData = {
  outboxEventId: string;
};

export type DispatchOutboxPublishResult = {
  status: 'enqueued' | 'already_published';
  eventId: string;
  jobId: string;
};

export type EnqueuePendingPublishJobsInput = {
  limit: number;
};

@Injectable()
export class DispatchOutboxPublisherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly queues: DispatchQueueService,
    @Inject(forwardRef(() => DispatchEventPublisher))
    private readonly realtime: DispatchEventPublisher,
  ) {}

  async enqueuePublishJob(
    eventId: string,
  ): Promise<DispatchOutboxPublishResult> {
    const event = await this.findEventForPublish(eventId);
    if (!event) {
      throw new NotFoundException('dispatch outbox event not found');
    }

    const jobId = dispatchJobIds.outboxPublish({
      outboxEventId: event.eventId,
    });

    if (event.publishedAt) {
      return {
        status: 'already_published',
        eventId: event.eventId,
        jobId,
      };
    }

    try {
      await this.queues.enqueue<DispatchOutboxPublishJobData>({
        queueName: DISPATCH_QUEUE_NAMES.outbox,
        jobName: DISPATCH_OUTBOX_PUBLISH_JOB_NAME,
        jobId,
        data: { outboxEventId: event.eventId },
      });
    } catch (error) {
      await this.recordPublishFailure(event.eventId, error);
      throw error;
    }

    return this.publishQueuedEvent(event.eventId);
  }

  async enqueuePendingPublishJobs(
    input: EnqueuePendingPublishJobsInput,
  ): Promise<DispatchOutboxPublishResult[]> {
    if (input.limit <= 0) {
      return [];
    }

    // Keep Redis enqueueing outside database transactions; each event is
    // rechecked and marked by enqueuePublishJob.
    const events = await this.db
      .select({ eventId: dispatchOutboxEvent.eventId })
      .from(dispatchOutboxEvent)
      .where(isNull(dispatchOutboxEvent.publishedAt))
      .orderBy(
        asc(dispatchOutboxEvent.occurredAt),
        asc(dispatchOutboxEvent.eventId),
      )
      .limit(input.limit);

    const results: DispatchOutboxPublishResult[] = [];
    for (const event of events) {
      results.push(await this.enqueuePublishJob(event.eventId));
    }

    return results;
  }

  async publishQueuedEvent(
    eventId: string,
  ): Promise<DispatchOutboxPublishResult> {
    const event = await this.findEventForPublish(eventId);
    if (!event) {
      throw new NotFoundException('dispatch outbox event not found');
    }

    const jobId = dispatchJobIds.outboxPublish({
      outboxEventId: event.eventId,
    });

    if (event.publishedAt) {
      return {
        status: 'already_published',
        eventId: event.eventId,
        jobId,
      };
    }

    const marked = await this.markPublished(event.eventId);
    if (marked) {
      await this.realtime.publishFromOutboxEvent(
        await this.requireEventForRealtimePublish(event.eventId),
      );
    }

    return {
      status: marked ? 'enqueued' : 'already_published',
      eventId: event.eventId,
      jobId,
    };
  }

  async countUnpublishedEvents(): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(dispatchOutboxEvent)
      .where(isNull(dispatchOutboxEvent.publishedAt));

    return row?.count ?? 0;
  }

  private async findEventForPublish(eventId: string) {
    const [event] = await this.db
      .select({
        eventId: dispatchOutboxEvent.eventId,
        publishedAt: dispatchOutboxEvent.publishedAt,
      })
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.eventId, eventId))
      .limit(1);

    return event ?? null;
  }

  private async markPublished(eventId: string): Promise<boolean> {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(dispatchOutboxEvent)
        .set({
          publishedAt: now,
          publishAttempts: sql`${dispatchOutboxEvent.publishAttempts} + 1`,
          lastPublishError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(dispatchOutboxEvent.eventId, eventId),
            isNull(dispatchOutboxEvent.publishedAt),
          ),
        )
        .returning({ eventId: dispatchOutboxEvent.eventId });

      return Boolean(updated);
    });
  }

  private async recordPublishFailure(
    eventId: string,
    error: unknown,
  ): Promise<void> {
    const now = new Date();
    const message = error instanceof Error ? error.message : String(error);

    await this.db.transaction(async (tx) => {
      await tx
        .update(dispatchOutboxEvent)
        .set({
          publishAttempts: sql`${dispatchOutboxEvent.publishAttempts} + 1`,
          lastPublishError: message.slice(0, 2_000),
          updatedAt: now,
        })
        .where(
          and(
            eq(dispatchOutboxEvent.eventId, eventId),
            isNull(dispatchOutboxEvent.publishedAt),
          ),
        );
    });
  }

  private async requireEventForRealtimePublish(eventId: string) {
    const [event] = await this.db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.eventId, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException('dispatch outbox event not found');
    }

    return event;
  }
}
