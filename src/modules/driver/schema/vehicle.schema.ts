import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';

export const ownershipTypeEnum = pgEnum('ownership_type', [
  'owner',
  'representative',
]);

export const plateRegionEnum = pgEnum('plate_region', [
  'aa',
  'or',
  'ah',
  'dr',
  'tg',
]);

export const plateCodeEnum = pgEnum('plate_code', ['01', '02', '03']);

export const plateCodeSubtypeEnum = pgEnum('plate_code_subtype', [
  'transport_service',
  'other',
]);

export const vehicleQualificationEnum = pgEnum('vehicle_qualification', [
  'standard',
  'comfort',
  'ev',
  'minibus',
]);

export const vehicleReviewStatusEnum = pgEnum('vehicle_review_status', [
  'pending',
  'approved',
  'rejected',
  'revoked',
]);

export const vehicle = pgTable(
  'vehicle',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    ownershipType: ownershipTypeEnum().notNull(),
    make: varchar({ length: 50 }).notNull(),
    model: varchar({ length: 50 }).notNull(),
    color: varchar({ length: 30 }).notNull(),
    year: integer().notNull(),
    plateRegion: plateRegionEnum().notNull(),
    plateCode: plateCodeEnum().notNull(),
    plateCodeSubtype: plateCodeSubtypeEnum(),
    plateNumber: varchar({ length: 20 }).notNull(),
    tinNumber: varchar({ length: 50 }),
    reviewStatus: vehicleReviewStatusEnum().notNull().default('pending'),
    reviewerId: uuid().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewReason: varchar({ length: 500 }),
    revokedAt: timestamp({ withTimezone: true }),
    qualifications: vehicleQualificationEnum().array(),
    reviewSnapshot: jsonb(),
    isApproved: boolean().notNull().default(false),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_ix_user_id').on(t.userId),
    uniqueIndex('vehicle_uq_active_user_id')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('vehicle_uq_active_plate_identity')
      .on(t.plateRegion, t.plateCode, t.plateNumber)
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      'vehicle_ck_plate_code_subtype',
      sql`((${t.plateCode} = '03' AND ${t.plateCodeSubtype} IS NOT NULL) OR (${t.plateCode} <> '03' AND ${t.plateCodeSubtype} IS NULL))`,
    ),
    check(
      'vehicle_ck_tin_required',
      sql`(NOT (${t.plateCode} = '01' OR (${t.plateCode} = '03' AND ${t.plateCodeSubtype} = 'transport_service')) OR NULLIF(BTRIM(${t.tinNumber}), '') IS NOT NULL)`,
    ),
  ],
);

export type Vehicle = typeof vehicle.$inferSelect;
export type NewVehicle = typeof vehicle.$inferInsert;
