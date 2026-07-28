import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { driverApplication } from './driver-application.schema';
import { vehicle } from './vehicle.schema';
import { user } from '../../user/schema/user.schema';

export const documentTypeEnum = pgEnum('document_type', [
  'vehicle_ownership',
  'representation_letter',
  'driver_license_front',
  'driver_license_back',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
]);

export const documentReviewStatusEnum = pgEnum('document_review_status', [
  'pending',
  'approved',
  'rejected',
  'revoked',
]);

export const document = pgTable(
  'document',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    driverApplicationId: uuid().references(() => driverApplication.id),
    vehicleId: uuid().references(() => vehicle.id),
    documentType: documentTypeEnum().notNull(),
    storageKey: varchar({ length: 255 }).notNull(),
    reviewStatus: documentReviewStatusEnum().notNull().default('pending'),
    reviewerId: uuid().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewReason: text(),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_ix_user_id').on(t.userId),
    index('document_ix_review_status').on(t.reviewStatus),
    index('document_ix_driver_application_id').on(t.driverApplicationId),
    index('document_ix_vehicle_id').on(t.vehicleId),
  ],
);

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
