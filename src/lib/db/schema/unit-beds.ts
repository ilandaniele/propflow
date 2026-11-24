import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, money, ts } from './columns';
import { organizations, tenants, units } from './core';

export const unitBeds = sqliteTable('unit_beds', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:      text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  label:       text('label').notNull(),
  monthlyRent: money('monthly_rent'),
  tenantId:    text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('unit_beds_unit_label_uidx').on(t.unitId, t.label),
  uniqueIndex('unit_beds_tenant_uidx').on(t.tenantId),
  index('idx_unit_beds_org_unit').on(t.orgId, t.unitId),
]);
