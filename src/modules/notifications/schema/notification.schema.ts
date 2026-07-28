import { sql } from 'drizzle-orm';
import {
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
import { notificationCategoryValues } from '../notifications.types';

export const notificationCategoryEnum = pgEnum(
  'notification_category',
  notificationCategoryValues,
);

export const notificationSourceEnum = pgEnum('notification_source', [
  'admin',
  'system',
]);

export const notification = pgTable(
  'notification',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    title: varchar({ length: 120 }).notNull(),
    body: text().notNull(),
    category: notificationCategoryEnum(),
    source: notificationSourceEnum().notNull().default('admin'),
    createdByUserId: uuid().references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('notification_ix_created_at').on(t.createdAt),
    index('notification_ix_category').on(t.category),
  ],
);

export const userNotification = pgTable(
  'user_notification',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    notificationId: uuid()
      .notNull()
      .references(() => notification.id, { onDelete: 'cascade' }),
    seenAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_notification_uq_user_notification').on(
      t.userId,
      t.notificationId,
    ),
    index('user_notification_ix_user_created').on(t.userId, t.createdAt),
    index('user_notification_ix_user_seen').on(t.userId, t.seenAt),
    index('user_notification_ix_deleted_at').on(t.deletedAt),
  ],
);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
export type UserNotification = typeof userNotification.$inferSelect;
export type NewUserNotification = typeof userNotification.$inferInsert;
export type NotificationSource = Notification['source'];
