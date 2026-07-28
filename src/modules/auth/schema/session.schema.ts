import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';

export const authSession = pgTable(
  'auth_session',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    deviceId: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('auth_session_uq_token_hash').on(t.tokenHash),
    index('auth_session_ix_user_id').on(t.userId),
  ],
);

export type AuthSession = typeof authSession.$inferSelect;
export type NewAuthSession = typeof authSession.$inferInsert;
