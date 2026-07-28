import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';
import {
  plateCodeEnum,
  plateCodeSubtypeEnum,
  plateRegionEnum,
} from '../../driver/schema/vehicle.schema';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';
import { dispatchOffer } from './dispatch-offer.schema';

export const dispatchAssignment = pgTable(
  'dispatch_assignment',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: uuid()
      .notNull()
      .references(() => rideRequest.id, { onDelete: 'cascade' }),
    offerId: uuid()
      .notNull()
      .references(() => dispatchOffer.id, { onDelete: 'cascade' }),
    riderId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    driverId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedAt: timestamp({ withTimezone: true }).notNull(),
    driverFullName: varchar({ length: 255 }).notNull(),
    driverPhone: varchar({ length: 32 }).notNull(),
    driverRating: integer().notNull(),
    vehicleMake: varchar({ length: 50 }).notNull(),
    vehicleModel: varchar({ length: 50 }).notNull(),
    vehicleColor: varchar({ length: 30 }).notNull(),
    vehiclePlateRegion: plateRegionEnum().notNull(),
    vehiclePlateCode: plateCodeEnum().notNull(),
    vehiclePlateCodeSubtype: plateCodeSubtypeEnum(),
    vehiclePlateNumber: varchar({ length: 20 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_assignment_uq_request').on(t.requestId),
    uniqueIndex('dispatch_assignment_uq_offer').on(t.offerId),
    check(
      'dispatch_assignment_ck_driver_full_name_nonempty',
      sql`NULLIF(BTRIM(${t.driverFullName}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_assignment_ck_driver_phone_nonempty',
      sql`NULLIF(BTRIM(${t.driverPhone}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_assignment_ck_driver_rating_range',
      sql`${t.driverRating} BETWEEN 1 AND 5`,
    ),
    check(
      'dispatch_assignment_ck_vehicle_make_nonempty',
      sql`NULLIF(BTRIM(${t.vehicleMake}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_assignment_ck_vehicle_model_nonempty',
      sql`NULLIF(BTRIM(${t.vehicleModel}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_assignment_ck_vehicle_color_nonempty',
      sql`NULLIF(BTRIM(${t.vehicleColor}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_assignment_ck_vehicle_plate_number_nonempty',
      sql`NULLIF(BTRIM(${t.vehiclePlateNumber}), '') IS NOT NULL`,
    ),
  ],
);

export type DispatchAssignment = typeof dispatchAssignment.$inferSelect;
export type NewDispatchAssignment = typeof dispatchAssignment.$inferInsert;
