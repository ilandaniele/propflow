import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expenseCategories, expenses, properties, recurringExpenses } from '@/lib/db/schema';

export type RecurringExpenseRow = {
  id: string;
  description: string;
  amount: string;
  dayOfMonth: number;
  active: boolean;
  lastPeriod: string | null;
  propertyName: string | null;
  categoryName: string | null;
};

const SQL_UUID = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

export async function listRecurringExpenses(orgId: string): Promise<RecurringExpenseRow[]> {
  return db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      amount: recurringExpenses.amount,
      dayOfMonth: recurringExpenses.dayOfMonth,
      active: recurringExpenses.active,
      lastPeriod: recurringExpenses.lastPeriod,
      propertyName: properties.name,
      categoryName: expenseCategories.name,
    })
    .from(recurringExpenses)
    .leftJoin(properties, eq(properties.id, recurringExpenses.propertyId))
    .leftJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
    .where(eq(recurringExpenses.orgId, orgId))
    .orderBy(asc(recurringExpenses.dayOfMonth), asc(recurringExpenses.description))
    .limit(200);
}

export async function belongsToOrg(orgId: string, refs: { propertyId?: string; categoryId?: string }): Promise<boolean> {
  const [property, category] = await Promise.all([
    refs.propertyId
      ? db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, refs.propertyId), eq(properties.orgId, orgId))).limit(1)
      : Promise.resolve([{ id: '' }]),
    refs.categoryId
      ? db.select({ id: expenseCategories.id }).from(expenseCategories)
        .where(and(eq(expenseCategories.id, refs.categoryId), eq(expenseCategories.orgId, orgId))).limit(1)
      : Promise.resolve([{ id: '' }]),
  ]);
  return property.length > 0 && category.length > 0;
}

export async function insertRecurringExpense(values: typeof recurringExpenses.$inferInsert): Promise<void> {
  await db.insert(recurringExpenses).values(values);
}

export async function setRecurringExpenseActive(orgId: string, id: string, active: boolean): Promise<boolean> {
  const rows = await db.update(recurringExpenses)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.orgId, orgId)))
    .returning({ id: recurringExpenses.id });
  return rows.length > 0;
}

export async function deleteRecurringExpense(orgId: string, id: string): Promise<boolean> {
  const rows = await db.delete(recurringExpenses)
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.orgId, orgId)))
    .returning({ id: recurringExpenses.id });
  return rows.length > 0;
}

/**
 * Creates one expense per active template not yet generated for `period`, then
 * marks those templates. Both statements run in one D1 batch, so a template is
 * never generated twice for the same period. Returns how many were created.
 */
export async function generateRecurringExpenses(orgId: string, period: string): Promise<number> {
  const due = and(
    eq(recurringExpenses.orgId, orgId),
    eq(recurringExpenses.active, true),
    or(isNull(recurringExpenses.lastPeriod), lt(recurringExpenses.lastPeriod, period)),
  );
  const nowMs = Date.now();

  const [created] = await db.batch([
    db.insert(expenses).select(
      db.select({
        id: SQL_UUID.as('id'),
        orgId: recurringExpenses.orgId,
        propertyId: recurringExpenses.propertyId,
        unitId: sql<string | null>`NULL`.as('unit_id'),
        categoryId: recurringExpenses.categoryId,
        amount: recurringExpenses.amount,
        description: recurringExpenses.description,
        incurredOn: sql<string>`${period} || '-' || printf('%02d', ${recurringExpenses.dayOfMonth})`.as('incurred_on'),
        receiptPath: sql<string | null>`NULL`.as('receipt_path'),
        createdAt: sql<number>`${nowMs}`.as('created_at'),
        updatedAt: sql<number>`${nowMs}`.as('updated_at'),
      }).from(recurringExpenses).where(due),
    ).returning({ id: expenses.id }),
    db.update(recurringExpenses).set({ lastPeriod: period, updatedAt: new Date(nowMs) }).where(due),
  ]);
  return created.length;
}

export type Option = { id: string; name: string };

export async function listFormOptions(orgId: string): Promise<{ properties: Option[]; categories: Option[] }> {
  const [propertyRows, categoryRows] = await Promise.all([
    db.select({ id: properties.id, name: properties.name }).from(properties)
      .where(eq(properties.orgId, orgId)).orderBy(asc(properties.name)).limit(500),
    db.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories)
      .where(eq(expenseCategories.orgId, orgId)).orderBy(asc(expenseCategories.name)).limit(200),
  ]);
  return { properties: propertyRows, categories: categoryRows };
}
