import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';

export const dispatchAttemptStateEnum = pgEnum('dispatch_attempt_state', [
  'in_progress',
  'completed',
  'failed',
  'exhausted',
]);

export const dispatchAttempt = pgTable(
  'dispatch_attempt',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: uuid()
      .notNull()
      .references(() => rideRequest.id, { onDelete: 'cascade' }),
    attemptNumber: integer().notNull(),
    state: dispatchAttemptStateEnum().notNull().default('in_progress'),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_attempt_uq_request_attempt_number').on(
      t.requestId,
      t.attemptNumber,
    ),
    index('dispatch_attempt_ix_request_id').on(t.requestId),
    index('dispatch_attempt_ix_state').on(t.state),
    check(
      'dispatch_attempt_ck_attempt_number_positive',
      sql`${t.attemptNumber} > 0`,
    ),
    check(
      'dispatch_attempt_ck_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);

export type DispatchAttempt = typeof dispatchAttempt.$inferSelect;
export type NewDispatchAttempt = typeof dispatchAttempt.$inferInsert;
