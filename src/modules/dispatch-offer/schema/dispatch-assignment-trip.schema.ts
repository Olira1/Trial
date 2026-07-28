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

export const dispatchAssignmentTripStateEnum = pgEnum(
  'dispatch_assignment_trip_state',
  ['started', 'completed'],
);

export const dispatchAssignmentTrip = pgTable(
  'dispatch_assignment_trip',
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
    state: dispatchAssignmentTripStateEnum().notNull().default('started'),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_assignment_trip_uq_assignment').on(t.assignmentId),
    index('dispatch_assignment_trip_ix_request').on(t.requestId),
    index('dispatch_assignment_trip_ix_driver').on(t.driverId),
    check(
      'dispatch_assignment_trip_ck_completed_at',
      sql`(${t.state} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.completedAt} >= ${t.startedAt}) OR (${t.state} = 'started' AND ${t.completedAt} IS NULL)`,
    ),
  ],
);

export type DispatchAssignmentTrip = typeof dispatchAssignmentTrip.$inferSelect;
export type NewDispatchAssignmentTrip =
  typeof dispatchAssignmentTrip.$inferInsert;
