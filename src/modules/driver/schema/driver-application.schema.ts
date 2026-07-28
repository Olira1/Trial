import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';

export const applicationStatusEnum = pgEnum('application_status', [
  'incomplete',
  'pending',
  'approved',
  'rejected',
  'revoked',
]);

export const driverApplication = pgTable(
  'driver_application',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    status: applicationStatusEnum().notNull().default('pending'),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewerId: uuid().references(() => user.id),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('driver_application_uq_user_id').on(t.userId),
    index('driver_application_ix_status').on(t.status),
  ],
);

export type DriverApplication = typeof driverApplication.$inferSelect;
export type NewDriverApplication = typeof driverApplication.$inferInsert;
