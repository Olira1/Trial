import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { authSession } from '../../auth/schema/session.schema';
import { user } from '../../user/schema/user.schema';

export const driverOperationalStateEnum = pgEnum('driver_operational_state', [
  'offline',
  'online',
  'offered',
  'assigned',
  'suspended',
]);

export const driverOperationalProfile = pgTable(
  'driver_operational_profile',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    operationalState: driverOperationalStateEnum().notNull().default('offline'),
    ownerSessionId: uuid().references(() => authSession.id, {
      onDelete: 'set null',
    }),
    presenceSessionId: text(),
    presenceGeneration: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('driver_operational_profile_uq_user_id').on(t.userId),
    uniqueIndex('driver_operational_profile_uq_presence_session_id')
      .on(t.presenceSessionId)
      .where(sql`${t.presenceSessionId} IS NOT NULL`),
    index('driver_operational_profile_ix_operational_state').on(
      t.operationalState,
    ),
    index('driver_operational_profile_ix_owner_session_id').on(
      t.ownerSessionId,
    ),
    check(
      'driver_operational_profile_ck_generation_nonnegative',
      sql`${t.presenceGeneration} >= 0`,
    ),
    check(
      'driver_operational_profile_ck_presence_authority',
      sql`(
        (
          ${t.operationalState} IN ('online', 'offered', 'assigned')
          AND ${t.ownerSessionId} IS NOT NULL
          AND NULLIF(BTRIM(${t.presenceSessionId}), '') IS NOT NULL
          AND ${t.presenceGeneration} > 0
        )
        OR
        (
          ${t.operationalState} IN ('offline', 'suspended')
          AND ${t.ownerSessionId} IS NULL
          AND ${t.presenceSessionId} IS NULL
        )
      )`,
    ),
  ],
);

export type DriverOperationalProfile =
  typeof driverOperationalProfile.$inferSelect;
export type NewDriverOperationalProfile =
  typeof driverOperationalProfile.$inferInsert;
