import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../user/schema/user.schema';
import { document } from './document.schema';

export const documentAuditActionEnum = pgEnum('document_audit_action', [
  'approved',
  'rejected',
  'revoked',
]);

export const documentAudit = pgTable(
  'document_audit',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    documentId: uuid()
      .notNull()
      .references(() => document.id),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    actorId: uuid()
      .notNull()
      .references(() => user.id),
    action: documentAuditActionEnum().notNull(),
    reason: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_audit_ix_document').on(t.documentId, t.occurredAt),
    index('document_audit_ix_user').on(t.userId, t.occurredAt),
    index('document_audit_ix_action').on(t.action, t.occurredAt),
  ],
);

export type DocumentAudit = typeof documentAudit.$inferSelect;
export type NewDocumentAudit = typeof documentAudit.$inferInsert;
