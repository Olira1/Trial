import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';
import { authIdentity } from './auth-identity.schema';

export const passkeyCredential = pgTable(
  'passkey_credential',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    identityId: uuid()
      .notNull()
      .references(() => authIdentity.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialId: varchar({ length: 512 }).notNull(),
    publicKey: text().notNull(),
    counter: integer().notNull().default(0),
    deviceType: varchar({ length: 20 }).notNull(),
    backedUp: boolean().notNull().default(false),
    transports: text().array(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('passkey_credential_uq_identity_id').on(t.identityId),
    uniqueIndex('passkey_credential_uq_credential_id').on(t.credentialId),
    index('passkey_credential_ix_user_id').on(t.userId),
  ],
);

export type PasskeyCredential = typeof passkeyCredential.$inferSelect;
export type NewPasskeyCredential = typeof passkeyCredential.$inferInsert;
