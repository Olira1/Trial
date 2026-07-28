import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';
import { dispatchAssignment } from './dispatch-assignment.schema';
import { dispatchOffer } from './dispatch-offer.schema';

export const dispatchCancellationActorRoleEnum = pgEnum(
  'dispatch_cancellation_actor_role',
  ['rider', 'driver', 'system'],
);

export const dispatchCancellationReasonEnum = pgEnum(
  'dispatch_cancellation_reason',
  [
    'generic',
    'wrong_pickup',
    'rider_changed_mind',
    'driver_delay',
    'driver_requested',
    'driver_emergency',
    'driver_no_show',
    'rider_no_show',
    'other',
  ],
);

export const dispatchCancellation = pgTable(
  'dispatch_cancellation',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: uuid()
      .notNull()
      .references(() => rideRequest.id, { onDelete: 'cascade' }),
    offerId: uuid().references(() => dispatchOffer.id, {
      onDelete: 'set null',
    }),
    assignmentId: uuid().references(() => dispatchAssignment.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    actorRole: dispatchCancellationActorRoleEnum().notNull(),
    reasonCode: dispatchCancellationReasonEnum().notNull().default('generic'),
    notes: varchar({ length: 500 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dispatch_cancellation_uq_request').on(t.requestId),
    index('dispatch_cancellation_ix_actor').on(t.actorUserId, t.createdAt),
    index('dispatch_cancellation_ix_assignment').on(t.assignmentId),
    check(
      'dispatch_cancellation_ck_notes_nonempty',
      sql`${t.notes} IS NULL OR NULLIF(BTRIM(${t.notes}), '') IS NOT NULL`,
    ),
    check(
      'dispatch_cancellation_ck_assignment_requires_offer',
      sql`${t.assignmentId} IS NULL OR ${t.offerId} IS NOT NULL`,
    ),
  ],
);

export type DispatchCancellation = typeof dispatchCancellation.$inferSelect;
export type NewDispatchCancellation = typeof dispatchCancellation.$inferInsert;
