import { sql } from 'drizzle-orm';
import { sqliteTable, text, index, check } from 'drizzle-orm/sqlite-core';
import { createdAt, dateStr, id, money, updatedAt } from './columns';
import { organizations, properties, units } from './core';

export const utilityContracts = sqliteTable('utility_contracts', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:      text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  unitId:          text('unit_id').references(() => units.id, { onDelete: 'cascade' }),
  utilityType:     text('utility_type').notNull(),
  provider:        text('provider').notNull(),
  supplyNumber:    text('supply_number'),
  holderKind:      text('holder_kind').notNull(),
  holderName:      text('holder_name').notNull(),
  monthlyEstimate: money('monthly_estimate'),
  startDate:       dateStr('start_date'),
  notes:           text('notes'),
  createdAt:       createdAt(),
  updatedAt:       updatedAt(),
}, (t) => [
  index('idx_utility_contracts_org_property').on(t.orgId, t.propertyId, t.createdAt),
  check('utility_contracts_type_check', sql`utility_type IN ('luz','agua','gas','internet','otro')`),
  check('utility_contracts_holder_kind_check', sql`holder_kind IN ('owner','tenant','other')`),
]);

export const utilityHolderChanges = sqliteTable('utility_holder_changes', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => utilityContracts.id, { onDelete: 'cascade' }),
  changedOn:  dateStr('changed_on').notNull(),
  fromHolder: text('from_holder').notNull(),
  toHolder:   text('to_holder').notNull(),
  reason:     text('reason'),
  createdAt:  createdAt(),
}, (t) => [
  index('idx_utility_holder_changes_contract').on(t.contractId, t.changedOn),
]);
