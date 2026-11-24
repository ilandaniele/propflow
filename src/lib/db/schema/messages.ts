import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

export const tenantMessages = sqliteTable('tenant_messages', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  senderId:  text('sender_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  kind:      text('kind').notNull(),                         // 'question'|'request'|'complaint'|'suggestion'
  subject:   text('subject').notNull(),
  body:      text('body').notNull(),
  status:    text('status').notNull().default('open'),       // 'open'|'answered'|'closed'
  reply:     text('reply'),
  repliedBy: text('replied_by').references(() => profiles.id, { onDelete: 'set null' }),
  repliedAt: ts('replied_at'),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  attachmentKey:  text('attachment_key'),
  attachmentName: text('attachment_name'),
  attachmentMime: text('attachment_mime'),
  attachmentSize: integer('attachment_size'),
}, (t) => [
  index('idx_tenant_messages_org_status').on(t.orgId, t.status, t.createdAt),
  index('idx_tenant_messages_sender').on(t.senderId, t.createdAt),
]);
