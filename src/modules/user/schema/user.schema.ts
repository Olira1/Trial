import { sql } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';

export const userRoleEnum = pgEnum('user_role', [
  'rider',
  'driver',
  'admin',
  'super_admin',
]);
export const userSignupIntentEnum = pgEnum('user_signup_intent', [
  'rider',
  'driver',
]);
export const genderEnum = pgEnum('gender', ['male', 'female']);

export const user = pgTable('user', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  firstName: varchar({ length: 100 }).notNull(),
  middleName: varchar({ length: 100 }),
  lastName: varchar({ length: 100 }).notNull(),
  emailVerified: boolean().notNull().default(false),
  imageKey: varchar({ length: 1024 }),
  phoneVerified: boolean().notNull().default(false),
  deviceId: varchar({ length: 255 }),
  roles: userRoleEnum().array().notNull(),
  signupIntent: userSignupIntentEnum(),
  gender: genderEnum(),
  isActive: boolean().notNull().default(true),
  deletedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type UserRole = User['roles'][number];
