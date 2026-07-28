import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
  type DBTransaction,
} from '../../database/database.module';
import type { DispatchOutboxEventType } from './dispatch-outbox.events';
import {
  dispatchOutboxEvent,
  type DispatchOutboxEvent,
} from './schema/dispatch-outbox.schema';

export type AppendDispatchOutboxEventInput = {
  eventId?: string;
  eventKey: string;
  eventType: DispatchOutboxEventType;
  schemaVersion?: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt?: Date;
  correlationId: string;
  causationId?: string;
  actorUserId?: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class DispatchOutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async append(
    tx: DBTransaction,
    input: AppendDispatchOutboxEventInput,
  ): Promise<DispatchOutboxEvent> {
    const [inserted] = await tx
      .insert(dispatchOutboxEvent)
      .values({
        eventId: input.eventId,
        eventKey: input.eventKey,
        eventType: input.eventType,
        schemaVersion: input.schemaVersion ?? 1,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
        actorUserId: input.actorUserId,
        payload: input.payload,
      })
      .onConflictDoNothing({
        target: dispatchOutboxEvent.eventKey,
      })
      .returning();

    if (inserted) {
      return inserted;
    }

    const existing = await this.findByEventKey(input.eventKey, tx);
    if (!existing) {
      throw new Error(
        `dispatch outbox event ${input.eventKey} conflicted but could not be loaded`,
      );
    }

    return existing;
  }

  async findByEventId(
    eventId: string,
    tx: DBExecutor = this.db,
  ): Promise<DispatchOutboxEvent | null> {
    const [event] = await tx
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.eventId, eventId))
      .limit(1);

    return event ?? null;
  }

  async findByEventKey(
    eventKey: string,
    tx: DBExecutor = this.db,
  ): Promise<DispatchOutboxEvent | null> {
    const [event] = await tx
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.eventKey, eventKey))
      .limit(1);

    return event ?? null;
  }
}
