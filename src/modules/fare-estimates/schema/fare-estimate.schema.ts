import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../../../database/spatial-conventions';
import { user } from '../../user/schema/user.schema';

export const fareEstimate = pgTable(
  'fare_estimate',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    riderId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pickup: geographyPoint().notNull(),
    destination: geographyPoint().notNull(),
    vehicleType: varchar({ length: 32 }).notNull(),
    currency: varchar({ length: 3 }).notNull(),
    distanceMeters: integer().notNull(),
    durationSeconds: integer().notNull(),
    rateMinorPerKm: integer().notNull(),
    estimatedFareMinor: integer().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('fare_estimate_ix_rider_created_at').on(t.riderId, t.createdAt),
    index('fare_estimate_ix_expires_at').on(t.expiresAt),
    check(
      'fare_estimate_ck_vehicle_type_standard',
      sql`${t.vehicleType} = 'standard'`,
    ),
    check('fare_estimate_ck_currency_etb', sql`${t.currency} = 'ETB'`),
    check('fare_estimate_ck_distance_positive', sql`${t.distanceMeters} > 0`),
    check('fare_estimate_ck_duration_positive', sql`${t.durationSeconds} > 0`),
    check('fare_estimate_ck_rate_positive', sql`${t.rateMinorPerKm} > 0`),
    check(
      'fare_estimate_ck_fare_nonnegative',
      sql`${t.estimatedFareMinor} >= 0`,
    ),
    check(
      'fare_estimate_ck_expiry_after_creation',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);

export type FareEstimate = typeof fareEstimate.$inferSelect;
export type NewFareEstimate = typeof fareEstimate.$inferInsert;
