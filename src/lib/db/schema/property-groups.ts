import { sqliteTable, text, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, properties } from './core';

export const propertyGroups = sqliteTable('property_groups', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('property_groups_org_name_uidx').on(t.orgId, t.name),
]);

export const propertyGroupMembers = sqliteTable('property_group_members', {
  groupId:    text('group_id').notNull().references(() => propertyGroups.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.propertyId] }),
  index('idx_property_group_members_property').on(t.propertyId),
]);
