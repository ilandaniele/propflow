import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { bool, id, json, ts } from './columns';
import { organizations } from './core';

export const customFieldDefinitions = sqliteTable('custom_field_definitions', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  key:        text('key').notNull(),
  label:      text('label').notNull(),
  fieldType:  text('field_type').notNull(),
  options:    json<string[]>('options'),
  required:   bool('required').notNull().default(false),
  sortOrder:  integer('sort_order').notNull().default(0),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('custom_field_definitions_org_entity_key_uidx').on(t.orgId, t.entityType, t.key),
  index('idx_custom_field_definitions_org_entity_sort').on(t.orgId, t.entityType, t.sortOrder),
  check('custom_field_definitions_entity_type_check', sql`entity_type IN ('property','unit','tenant','contract')`),
  check('custom_field_definitions_field_type_check', sql`field_type IN ('text','number','date','boolean','select')`),
]);

export const customFieldValues = sqliteTable('custom_field_values', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  definitionId: text('definition_id').notNull().references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  entityId:     text('entity_id').notNull(),
  value:        text('value').notNull(),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('custom_field_values_definition_entity_uidx').on(t.definitionId, t.entityId),
  index('idx_custom_field_values_org_entity').on(t.orgId, t.entityId),
]);
