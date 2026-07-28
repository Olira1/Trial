import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';
import { user } from '../../user/schema/user.schema';

export const pushPlatformEnum = pgEnum('push_platform', [
  'android',
  'ios',
  'web',
]);

export const pushDeviceToken = pgTable(
  'push_device_token',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: varchar({ length: 255 }).notNull(),
    platform: pushPlatformEnum().notNull(),
    token: text().notNull(),
    isActive: boolean().notNull().default(true),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('push_device_token_uq_user_device').on(t.userId, t.deviceId),
    index('push_device_token_ix_user_id').on(t.userId),
    index('push_device_token_ix_token').on(t.token),
  ],
);

export type PushDeviceToken = typeof pushDeviceToken.$inferSelect;
export type NewPushDeviceToken = typeof pushDeviceToken.$inferInsert;
export type PushPlatform = PushDeviceToken['platform'];
