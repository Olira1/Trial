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
import { driverApplication } from './driver-application.schema';

export const driverApplicationAuditActionEnum = pgEnum(
  'driver_application_audit_action',
  ['submitted', 'approved', 'rejected', 'revoked'],
);

export const driverApplicationAudit = pgTable(
  'driver_application_audit',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    applicationId: uuid()
      .notNull()
      .references(() => driverApplication.id),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    actorId: uuid()
      .notNull()
      .references(() => user.id),
    action: driverApplicationAuditActionEnum().notNull(),
    reason: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_application_audit_ix_application').on(
      t.applicationId,
      t.occurredAt,
    ),
    index('driver_application_audit_ix_user').on(t.userId, t.occurredAt),
  ],
);

export type DriverApplicationAudit = typeof driverApplicationAudit.$inferSelect;
export type NewDriverApplicationAudit =
  typeof driverApplicationAudit.$inferInsert;
