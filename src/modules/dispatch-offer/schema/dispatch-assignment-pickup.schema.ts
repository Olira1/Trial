import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';
import { dispatchAssignment } from './dispatch-assignment.schema';
import { dispatchOffer } from './dispatch-offer.schema';

export const dispatchAssignmentPickupStateEnum = pgEnum(
  'dispatch_assignment_pickup_state',
  ['arrived', 'warning_sent', 'rider_no_show_cancelled'],
);

export const dispatchAssignmentPickup = pgTable(
  'dispatch_assignment_pickup',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    assignmentId: uuid()
      .notNull()
      .references(() => dispatchAssignment.id, { onDelete: 'cascade' }),
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
    state: dispatchAssignmentPickupStateEnum().notNull().default('arrived'),
    arrivedAt: timestamp({ withTimezone: true }).notNull(),
    warningDueAt: timestamp({ withTimezone: true }).notNull(),
    warningSentAt: timestamp({ withTimezone: true }),
    noShowCancellableAt: timestamp({ withTimezone: true }).notNull(),
    noShowCancelledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_assignment_pickup_uq_assignment').on(t.assignmentId),
    uniqueIndex('dispatch_assignment_pickup_uq_request').on(t.requestId),
    uniqueIndex('dispatch_assignment_pickup_uq_offer').on(t.offerId),
    index('dispatch_assignment_pickup_ix_driver_state').on(t.driverId, t.state),
    index('dispatch_assignment_pickup_ix_warning_due').on(
      t.warningSentAt,
      t.warningDueAt,
    ),
    index('dispatch_assignment_pickup_ix_no_show_due').on(
      t.noShowCancelledAt,
      t.noShowCancellableAt,
    ),
    check(
      'dispatch_assignment_pickup_ck_warning_due_after_arrival',
      sql`${t.warningDueAt} >= ${t.arrivedAt}`,
    ),
    check(
      'dispatch_assignment_pickup_ck_no_show_due_after_arrival',
      sql`${t.noShowCancellableAt} >= ${t.arrivedAt}`,
    ),
    check(
      'dispatch_assignment_pickup_ck_warning_sent_after_arrival',
      sql`${t.warningSentAt} IS NULL OR ${t.warningSentAt} >= ${t.arrivedAt}`,
    ),
    check(
      'dispatch_assignment_pickup_ck_no_show_cancelled_after_arrival',
      sql`${t.noShowCancelledAt} IS NULL OR ${t.noShowCancelledAt} >= ${t.arrivedAt}`,
    ),
  ],
);

export type DispatchAssignmentPickup =
  typeof dispatchAssignmentPickup.$inferSelect;
export type NewDispatchAssignmentPickup =
  typeof dispatchAssignmentPickup.$inferInsert;
