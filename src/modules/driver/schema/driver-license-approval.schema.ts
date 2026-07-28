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
import { driverApplication } from './driver-application.schema';

export const driverLicenseIssuerEnum = pgEnum('driver_license_issuer', [
  'addis_ababa',
  'oromia',
  'amhara',
  'dire_dawa',
  'tigray',
  'afar',
  'benishangul_gumuz',
  'gambela',
  'harari',
  'sidama',
  'somali',
  'south_west',
  'south_ethiopia',
  'central_ethiopia',
]);

export const driverLicenseTypeEnum = pgEnum('driver_license_type', [
  'T1',
  'T2',
  'P1',
  'P2',
  'F1',
  'F2',
  'F3',
  'machinery',
  'motorcycle',
]);

export const approvalReviewStatusEnum = pgEnum('approval_review_status', [
  'pending',
  'approved',
  'rejected',
  'revoked',
]);

export const driverLicenseApproval = pgTable(
  'driver_license_approval',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    driverApplicationId: uuid()
      .notNull()
      .references(() => driverApplication.id),
    reviewStatus: approvalReviewStatusEnum().notNull().default('pending'),
    licenseNumber: text(),
    issuedBy: driverLicenseIssuerEnum(),
    licenseType: driverLicenseTypeEnum(),
    reviewerId: uuid().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewReason: text(),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('driver_license_approval_uq_user').on(t.userId),
    index('driver_license_approval_ix_application').on(t.driverApplicationId),
    index('driver_license_approval_ix_status').on(t.reviewStatus),
  ],
);

export type DriverLicenseApproval = typeof driverLicenseApproval.$inferSelect;
export type NewDriverLicenseApproval =
  typeof driverLicenseApproval.$inferInsert;
