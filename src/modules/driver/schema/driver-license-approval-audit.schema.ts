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
import { driverLicenseApproval } from './driver-license-approval.schema';

export const driverLicenseApprovalAuditActionEnum = pgEnum(
  'driver_license_approval_audit_action',
  ['approved', 'rejected', 'revoked'],
);

export const driverLicenseApprovalAudit = pgTable(
  'driver_license_approval_audit',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    licenseApprovalId: uuid()
      .notNull()
      .references(() => driverLicenseApproval.id),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    actorId: uuid()
      .notNull()
      .references(() => user.id),
    action: driverLicenseApprovalAuditActionEnum().notNull(),
    reason: text().notNull(),
    licenseNumber: text(),
    issuedBy: text(),
    licenseType: text(),
    expiresAt: timestamp({ withTimezone: true }),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_license_approval_audit_ix_license').on(
      t.licenseApprovalId,
      t.occurredAt,
    ),
    index('driver_license_approval_audit_ix_user').on(t.userId, t.occurredAt),
    index('driver_license_approval_audit_ix_action').on(t.action, t.occurredAt),
  ],
);

export type DriverLicenseApprovalAudit =
  typeof driverLicenseApprovalAudit.$inferSelect;
export type NewDriverLicenseApprovalAudit =
  typeof driverLicenseApprovalAudit.$inferInsert;
