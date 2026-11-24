import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, properties } from './core';

export const buildingStaff = sqliteTable('building_staff', {
  id:             id(),
  orgId:          text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:     text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  fullName:       text('full_name').notNull(),
  position:       text('position').notNull(),
  shift:          text('shift'),
  phone:          text('phone'),
  documentNumber: text('document_number'),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_building_staff_org').on(t.orgId),
]);
