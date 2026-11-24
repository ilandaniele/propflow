import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

export const periodCloses = sqliteTable('period_closes', {
  id:       id(),
  orgId:    text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  period:   text('period').notNull(),
  note:     text('note'),
  closedBy: text('closed_by').references(() => profiles.id, { onDelete: 'set null' }),
  closedAt: ts('closed_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('period_closes_org_period_uniq').on(t.orgId, t.period),
  index('idx_period_closes_org').on(t.orgId),
]);
