import { sqliteTable, text, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts, money, dateStr } from './columns';
import { organizations, properties } from './core';
import { expenseCategories } from './finance';

export const payables = sqliteTable('payables', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:   text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  categoryId:   text('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  supplierName: text('supplier_name').notNull(),
  description:  text('description'),
  documentRef:  text('document_ref'),
  amount:       money('amount').notNull(),
  issuedOn:     dateStr('issued_on').notNull(),
  dueOn:        dateStr('due_on').notNull(),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_payables_org_due').on(t.orgId, t.dueOn),
  check('payables_amount_check', sql`CAST(amount AS REAL) > 0`),
]);

export const payablePayments = sqliteTable('payable_payments', {
  id:        id(),
  payableId: text('payable_id').notNull().references(() => payables.id, { onDelete: 'cascade' }),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amount:    money('amount').notNull(),
  paidOn:    dateStr('paid_on').notNull(),
  note:      text('note'),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_payable_payments_payable').on(t.payableId),
  index('idx_payable_payments_org_paid').on(t.orgId, t.paidOn),
  check('payable_payments_amount_check', sql`CAST(amount AS REAL) > 0`),
]);
