import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts, money, bool } from './columns';
import { organizations, properties } from './core';
import { expenseCategories } from './finance';

export const recurringExpenses = sqliteTable('recurring_expenses', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:  text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  categoryId:  text('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  amount:      money('amount').notNull(),
  description: text('description').notNull(),
  dayOfMonth:  integer('day_of_month').notNull(),
  active:      bool('active').notNull().default(true),
  lastPeriod:  text('last_period'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_recurring_expenses_org').on(t.orgId),
  check('recurring_expenses_amount_check', sql`CAST(amount AS REAL) > 0`),
  check('recurring_expenses_day_check', sql`day_of_month BETWEEN 1 AND 28`),
]);
