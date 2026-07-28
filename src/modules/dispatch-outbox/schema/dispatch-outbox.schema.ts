import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';

export const dispatchOutboxEvent = pgTable(
  'dispatch_outbox_event',
  {
    eventId: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    eventKey: varchar({ length: 240 }).notNull(),
    eventType: varchar({ length: 120 }).notNull(),
    schemaVersion: integer().notNull().default(1),
    aggregateType: varchar({ length: 80 }).notNull(),
    aggregateId: uuid().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid().notNull(),
    causationId: uuid(),
    actorUserId: uuid(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    publishAttempts: integer().notNull().default(0),
    lastPublishError: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_outbox_event_uq_event_key').on(t.eventKey),
    index('dispatch_outbox_event_ix_unpublished').on(t.publishedAt, t.eventId),
    index('dispatch_outbox_event_ix_correlation_id').on(t.correlationId),
    index('dispatch_outbox_event_ix_aggregate').on(
      t.aggregateType,
      t.aggregateId,
    ),
  ],
);

export type DispatchOutboxEvent = typeof dispatchOutboxEvent.$inferSelect;
export type NewDispatchOutboxEvent = typeof dispatchOutboxEvent.$inferInsert;
