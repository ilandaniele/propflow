import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db';
import { expenseCategories, expenses, properties } from '@/lib/db/schema';
import type { ExpenseKind } from '@/lib/schemas/finance';
import type { CategoryRow } from './categories';

export async function listExpenseCategories(orgId: string): Promise<CategoryRow[]> {
  return db
    .select({ id: expenseCategories.id, name: expenseCategories.name, color: expenseCategories.color, parentId: expenseCategories.parentId })
    .from(expenseCategories)
    .where(eq(expenseCategories.orgId, orgId));
}

export async function findExpenseCategory(orgId: string, id: string) {
  const rows = await db
    .select({ id: expenseCategories.id, parentId: expenseCategories.parentId })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

const parentCategories = alias(expenseCategories, 'parent_categories');

export async function listMonthExpenses(orgId: string, month: string, kind?: ExpenseKind) {
  const [year, monthIndex] = month.split('-').map(Number);
  const nextMonth = monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      description: expenses.description,
      incurredOn: expenses.incurredOn,
      kind: expenses.kind,
      categoryName: expenseCategories.name,
      parentCategoryName: parentCategories.name,
      propertyName: properties.name,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(parentCategories, eq(parentCategories.id, expenseCategories.parentId))
    .leftJoin(properties, eq(properties.id, expenses.propertyId))
    .where(and(
      eq(expenses.orgId, orgId),
      gte(expenses.incurredOn, `${month}-01`),
      lt(expenses.incurredOn, `${nextMonth}-01`),
      kind ? eq(expenses.kind, kind) : undefined,
    ))
    .orderBy(desc(expenses.incurredOn), desc(expenses.createdAt))
    .limit(500);
}
