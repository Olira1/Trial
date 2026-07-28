import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';
import { vehicle } from './vehicle.schema';

export const vehicleAuditActionEnum = pgEnum('vehicle_audit_action', [
  'approved',
  'rejected',
  'revoked',
]);

export const vehicleAudit = pgTable(
  'vehicle_audit',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    vehicleId: uuid()
      .notNull()
      .references(() => vehicle.id),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    actorId: uuid()
      .notNull()
      .references(() => user.id),
    action: vehicleAuditActionEnum().notNull(),
    reason: text().notNull(),
    tinNumber: text(),
    qualifications: text().array(),
    snapshot: jsonb(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_audit_ix_vehicle').on(t.vehicleId, t.occurredAt),
    index('vehicle_audit_ix_user').on(t.userId, t.occurredAt),
    index('vehicle_audit_ix_action').on(t.action, t.occurredAt),
  ],
);

export type VehicleAudit = typeof vehicleAudit.$inferSelect;
export type NewVehicleAudit = typeof vehicleAudit.$inferInsert;
