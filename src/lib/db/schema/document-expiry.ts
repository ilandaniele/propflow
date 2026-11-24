import { sqliteTable, text, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts, dateStr } from './columns';
import { organizations, properties, tenants } from './core';

export const EXPIRING_DOCUMENT_KINDS = ['dni', 'insurance', 'certificate', 'other'] as const;

export const expiringDocuments = sqliteTable('expiring_documents', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind:       text('kind').notNull(),
  label:      text('label').notNull(),
  tenantId:   text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  expiresOn:  dateStr('expires_on').notNull(),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_expiring_documents_org_expires').on(t.orgId, t.expiresOn),
  check('expiring_documents_kind_check', sql`kind IN ('dni','insurance','certificate','other')`),
]);
