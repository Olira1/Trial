import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';

export const authIdentityTypeEnum = pgEnum('auth_identity_type', [
  'phone',
  'email',
  'passkey',
]);

export const authIdentity = pgTable(
  'auth_identity',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: authIdentityTypeEnum().notNull(),
    identifier: text().notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
    passwordHash: text(),
    lastUsedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('auth_identity_uq_type_identifier').on(t.type, t.identifier),
    index('auth_identity_ix_user_id').on(t.userId),
  ],
);

export type AuthIdentity = typeof authIdentity.$inferSelect;
export type NewAuthIdentity = typeof authIdentity.$inferInsert;
