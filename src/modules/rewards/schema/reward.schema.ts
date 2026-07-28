import { sql } from 'drizzle-orm';
import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';

export const rewardSourceEnum = pgEnum('reward_source', ['early_joiner_daily']);

export const userRewardLedger = pgTable(
  'user_reward_ledger',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rewardDate: date().notNull(),
    miles: numeric({ precision: 10, scale: 1, mode: 'number' }).notNull(),
    source: rewardSourceEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_reward_ledger_uq_user_date_source').on(
      t.userId,
      t.rewardDate,
      t.source,
    ),
    index('user_reward_ledger_ix_user_id').on(t.userId),
  ],
);

export type UserRewardLedger = typeof userRewardLedger.$inferSelect;
export type NewUserRewardLedger = typeof userRewardLedger.$inferInsert;
