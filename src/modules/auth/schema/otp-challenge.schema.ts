import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authIdentity } from './auth-identity.schema';

export const otpChannelEnum = pgEnum('otp_channel', ['phone', 'email']);
export const otpPurposeEnum = pgEnum('otp_purpose', [
  'sign_up',
  'login',
  'connect_email',
  'admin_login',
  'password_reset',
]);

export const otpChallenge = pgTable(
  'otp_challenge',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    identityId: uuid()
      .references(() => authIdentity.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    destination: text().notNull(),
    channel: otpChannelEnum().notNull(),
    purpose: otpPurposeEnum(),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_challenge_ix_destination_channel').on(t.destination, t.channel),
    index('otp_challenge_ix_expires_at').on(t.expiresAt),
  ],
);

export type OtpChallenge = typeof otpChallenge.$inferSelect;
export type NewOtpChallenge = typeof otpChallenge.$inferInsert;
export type OtpPurpose = NonNullable<OtpChallenge['purpose']>;
