import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../../../database/timestamps';

export const adBannerAudienceEnum = pgEnum('ad_banner_audience', [
  'all_users',
  'riders',
  'drivers',
]);

export const adBanner = pgTable(
  'ad_banner',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    title: varchar({ length: 120 }),
    imageKey: varchar({ length: 1024 }).notNull(),
    linkUrl: text(),
    audience: adBannerAudienceEnum().notNull().default('all_users'),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('ad_banner_ix_active_sort').on(t.isActive, t.sortOrder),
    index('ad_banner_ix_audience').on(t.audience),
    index('ad_banner_ix_active_window_sort').on(
      t.isActive,
      t.startsAt,
      t.endsAt,
      t.sortOrder,
    ),
    index('ad_banner_ix_deleted_at').on(t.deletedAt),
  ],
);

export type AdBanner = typeof adBanner.$inferSelect;
export type NewAdBanner = typeof adBanner.$inferInsert;
export type AdBannerAudience = AdBanner['audience'];
