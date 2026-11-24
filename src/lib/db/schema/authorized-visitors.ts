import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles, units } from './core';

export const authorizedVisitors = sqliteTable('authorized_visitors', {
  id:             id(),
  orgId:          text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:         text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  fullName:       text('full_name').notNull(),
  documentNumber: text('document_number'),
  relationship:   text('relationship'),
  createdBy:      text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_authorized_visitors_org').on(t.orgId),
  index('idx_authorized_visitors_unit').on(t.unitId),
]);
