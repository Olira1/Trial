import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';

export const driverComplianceEventActionEnum = pgEnum(
  'driver_compliance_event_action',
  ['suspended', 'reinstated'],
);

export const driverComplianceEvent = pgTable(
  'driver_compliance_event',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    actorId: uuid()
      .notNull()
      .references(() => user.id),
    action: driverComplianceEventActionEnum().notNull(),
    reason: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_compliance_event_ix_user').on(t.userId, t.occurredAt),
    index('driver_compliance_event_ix_action').on(t.action, t.occurredAt),
  ],
);

export type DriverComplianceEvent = typeof driverComplianceEvent.$inferSelect;
export type NewDriverComplianceEvent =
  typeof driverComplianceEvent.$inferInsert;
