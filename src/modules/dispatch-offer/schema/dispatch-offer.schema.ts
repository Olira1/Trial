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
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';
import { dispatchAttempt } from './dispatch-attempt.schema';

export const dispatchOfferStateEnum = pgEnum('dispatch_offer_state', [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
]);

export const dispatchOffer = pgTable(
  'dispatch_offer',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: uuid()
      .notNull()
      .references(() => rideRequest.id, { onDelete: 'cascade' }),
    attemptId: uuid()
      .notNull()
      .references(() => dispatchAttempt.id, { onDelete: 'cascade' }),
    driverId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    state: dispatchOfferStateEnum().notNull().default('pending'),
    offeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    respondedAt: timestamp({ withTimezone: true }),
    etaSeconds: integer(),
    distanceMeters: integer(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_offer_uq_request_pending')
      .on(t.requestId)
      .where(sql`${t.state} = 'pending'`),
    uniqueIndex('dispatch_offer_uq_driver_pending')
      .on(t.driverId)
      .where(sql`${t.state} = 'pending'`),
    index('dispatch_offer_ix_request_id').on(t.requestId),
    index('dispatch_offer_ix_driver_id').on(t.driverId),
    index('dispatch_offer_ix_state').on(t.state),
    check(
      'dispatch_offer_ck_expires_after_offered',
      sql`${t.expiresAt} > ${t.offeredAt}`,
    ),
    check(
      'dispatch_offer_ck_eta_positive',
      sql`${t.etaSeconds} IS NULL OR ${t.etaSeconds} > 0`,
    ),
    check(
      'dispatch_offer_ck_distance_positive',
      sql`${t.distanceMeters} IS NULL OR ${t.distanceMeters} > 0`,
    ),
  ],
);

export type DispatchOffer = typeof dispatchOffer.$inferSelect;
export type NewDispatchOffer = typeof dispatchOffer.$inferInsert;
