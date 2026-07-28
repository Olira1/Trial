import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';
import { authIdentityTypeEnum } from './auth-identity.schema';

export const authIdentityHistory = pgTable(
  'auth_identity_history',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    identityId: uuid().notNull(),
    type: authIdentityTypeEnum().notNull(),
    identifierHash: text().notNull(),
    identifierMasked: text().notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('auth_identity_history_ix_user_id').on(t.userId),
    index('auth_identity_history_ix_identity_id').on(t.identityId),
    index('auth_identity_history_ix_identifier_hash').on(t.identifierHash),
    index('auth_identity_history_ix_deleted_at').on(t.deletedAt),
  ],
);

export type AuthIdentityHistory = typeof authIdentityHistory.$inferSelect;
export type NewAuthIdentityHistory = typeof authIdentityHistory.$inferInsert;
