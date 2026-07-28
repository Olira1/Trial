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
  varchar,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../../../database/spatial-conventions';
import { timestamps } from '../../../database/timestamps';
import { fareEstimate } from '../../fare-estimates/schema/fare-estimate.schema';
import { user } from '../../user/schema/user.schema';

export const rideRequestStateEnum = pgEnum('ride_request_state', [
  'searching',
  'offered',
  'assigned',
  'completed',
  'cancelled',
  'expired',
  'no_driver_found',
  'system_failed',
]);

export const rideRequest = pgTable(
  'ride_request',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    riderId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    state: rideRequestStateEnum().notNull().default('searching'),
    pickup: geographyPoint().notNull(),
    destination: geographyPoint().notNull(),
    fareEstimateId: uuid().references(() => fareEstimate.id),
    vehicleType: varchar({ length: 32 }),
    rideType: varchar({ length: 32 }),
    currency: varchar({ length: 3 }),
    distanceMeters: integer(),
    durationSeconds: integer(),
    rateMinorPerKm: integer(),
    estimatedFareMinor: integer(),
    idempotencyKey: varchar({ length: 255 }).notNull(),
    offerTtlSeconds: integer().notNull(),
    matchingDeadlineSeconds: integer().notNull(),
    matchingDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ride_request_uq_rider_idempotency').on(
      t.riderId,
      t.idempotencyKey,
    ),
    index('ride_request_ix_state').on(t.state),
    uniqueIndex('ride_request_uq_active_rider')
      .on(t.riderId)
      .where(sql`${t.state} IN ('searching', 'offered')`),
    uniqueIndex('ride_request_uq_fare_estimate')
      .on(t.fareEstimateId)
      .where(sql`${t.fareEstimateId} IS NOT NULL`),
    check('ride_request_ck_offer_ttl_valid', sql`${t.offerTtlSeconds} > 0`),
    check(
      'ride_request_ck_matching_deadline_future',
      sql`${t.matchingDeadlineAt} > ${t.createdAt}`,
    ),
    check(
      'ride_request_ck_ride_type_instant',
      sql`${t.rideType} IS NULL OR ${t.rideType} = 'instant'`,
    ),
    check(
      'ride_request_ck_vehicle_type_standard',
      sql`${t.vehicleType} IS NULL OR ${t.vehicleType} = 'standard'`,
    ),
    check(
      'ride_request_ck_currency_etb',
      sql`${t.currency} IS NULL OR ${t.currency} = 'ETB'`,
    ),
    check(
      'ride_request_ck_distance_positive',
      sql`${t.distanceMeters} IS NULL OR ${t.distanceMeters} > 0`,
    ),
    check(
      'ride_request_ck_duration_positive',
      sql`${t.durationSeconds} IS NULL OR ${t.durationSeconds} > 0`,
    ),
    check(
      'ride_request_ck_rate_positive',
      sql`${t.rateMinorPerKm} IS NULL OR ${t.rateMinorPerKm} > 0`,
    ),
    check(
      'ride_request_ck_fare_nonnegative',
      sql`${t.estimatedFareMinor} IS NULL OR ${t.estimatedFareMinor} >= 0`,
    ),
    check(
      'ride_request_ck_fare_snapshot_all_or_none',
      sql`(
        ${t.fareEstimateId} IS NULL AND
        ${t.vehicleType} IS NULL AND
        ${t.rideType} IS NULL AND
        ${t.currency} IS NULL AND
        ${t.distanceMeters} IS NULL AND
        ${t.durationSeconds} IS NULL AND
        ${t.rateMinorPerKm} IS NULL AND
        ${t.estimatedFareMinor} IS NULL
      ) OR (
        ${t.fareEstimateId} IS NOT NULL AND
        ${t.vehicleType} IS NOT NULL AND
        ${t.rideType} IS NOT NULL AND
        ${t.currency} IS NOT NULL AND
        ${t.distanceMeters} IS NOT NULL AND
        ${t.durationSeconds} IS NOT NULL AND
        ${t.rateMinorPerKm} IS NOT NULL AND
        ${t.estimatedFareMinor} IS NOT NULL
      )`,
    ),
  ],
);

export type RideRequest = typeof rideRequest.$inferSelect;
export type NewRideRequest = typeof rideRequest.$inferInsert;
