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
import { user } from '../../user/schema/user.schema';

export const supportBugSeverityEnum = pgEnum('support_bug_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const supportBugImpactEnum = pgEnum('support_bug_impact', [
  'minor_glitch',
  'feature_broken',
  'cant_use_app',
]);

export const supportBugAreaEnum = pgEnum('support_bug_area', [
  'crash',
  'ui_layout',
  'booking',
  'other',
]);

export const supportFeedbackTopicEnum = pgEnum('support_feedback_topic', [
  'app_experience',
  'driver_trip',
  'support',
  'other',
]);

export const supportContactTypeEnum = pgEnum('support_contact_type', [
  'emergency',
  'trusted',
]);

export const supportBugReport = pgTable(
  'support_bug_report',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    severity: supportBugSeverityEnum().notNull(),
    impact: supportBugImpactEnum().notNull(),
    area: supportBugAreaEnum().notNull(),
    details: text().notNull(),
    stepsToReproduce: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_bug_report_ix_user_id').on(t.userId)],
);

export const supportBugReportScreenshot = pgTable(
  'support_bug_report_screenshot',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    bugReportId: uuid()
      .notNull()
      .references(() => supportBugReport.id),
    storageKey: varchar({ length: 255 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('support_bug_report_screenshot_ix_bug_report_id').on(t.bugReportId),
  ],
);

export const supportFeedback = pgTable(
  'support_feedback',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    rating: integer().notNull(),
    topic: supportFeedbackTopicEnum().notNull(),
    wouldRecommend: boolean().notNull(),
    title: varchar({ length: 120 }),
    feedback: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_feedback_ix_user_id').on(t.userId)],
);

export const supportContact = pgTable(
  'support_contact',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    type: supportContactTypeEnum().notNull(),
    name: varchar({ length: 100 }).notNull(),
    phone: varchar({ length: 20 }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_contact_ix_user_id_type').on(t.userId, t.type)],
);

export type SupportBugReport = typeof supportBugReport.$inferSelect;
export type NewSupportBugReport = typeof supportBugReport.$inferInsert;
export type SupportBugReportScreenshot =
  typeof supportBugReportScreenshot.$inferSelect;
export type NewSupportBugReportScreenshot =
  typeof supportBugReportScreenshot.$inferInsert;
export type SupportFeedback = typeof supportFeedback.$inferSelect;
export type NewSupportFeedback = typeof supportFeedback.$inferInsert;
export type SupportContact = typeof supportContact.$inferSelect;
export type NewSupportContact = typeof supportContact.$inferInsert;
export type SupportContactType = SupportContact['type'];
