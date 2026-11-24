import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expenseBudgets, expenseCategories, expenses } from '@/lib/db/schema';
import type { ExpenseBudgetInput } from '@/lib/schemas/budget';
import type { BudgetCategory, CategorySpend } from './budget-math';

export type SetBudgetResult = { status: 'not_found' } | { status: 'done' };

export async function setExpenseBudget(orgId: string, input: ExpenseBudgetInput): Promise<SetBudgetResult> {
  const [category] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, input.category_id), eq(expenseCategories.orgId, orgId)))
    .limit(1);
  if (!category) return { status: 'not_found' };

  const now = new Date();
  const amount = input.amount.toFixed(2);
  await db
    .insert(expenseBudgets)
    .values({ orgId, categoryId: input.category_id, year: input.year, amount, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [expenseBudgets.orgId, expenseBudgets.categoryId, expenseBudgets.year],
      set: { amount, updatedAt: now },
    });
  return { status: 'done' };
}

export async function listBudgetCategories(orgId: string, year: number): Promise<BudgetCategory[]> {
  const rows = await db
    .select({ categoryId: expenseCategories.id, name: expenseCategories.name, amount: expenseBudgets.amount })
    .from(expenseCategories)
    .leftJoin(
      expenseBudgets,
      and(eq(expenseBudgets.categoryId, expenseCategories.id), eq(expenseBudgets.year, year)),
    )
    .where(eq(expenseCategories.orgId, orgId))
    .orderBy(asc(expenseCategories.name))
    .limit(200);
  return rows.map((row) => ({ categoryId: row.categoryId, name: row.name, annualBudget: Number(row.amount ?? 0) }));
}

export async function spendByCategoryMonth(orgId: string, year: number): Promise<CategorySpend[]> {
  const month = sql<number>`cast(substr(${expenses.incurredOn}, 6, 2) as integer)`;
  const rows = await db
    .select({ categoryId: expenses.categoryId, month, amount: sql<number>`sum(cast(${expenses.amount} as real))` })
    .from(expenses)
    .where(and(eq(expenses.orgId, orgId), sql`substr(${expenses.incurredOn}, 1, 4) = ${String(year)}`))
    .groupBy(expenses.categoryId, month);
  return rows.map((row) => ({ categoryId: row.categoryId, month: Number(row.month), amount: Number(row.amount) }));
}
