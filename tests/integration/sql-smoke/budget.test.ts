import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: 'admin-1', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { setExpenseBudget } from '@/app/actions/budget';
import { listBudgetCategories, spendByCategoryMonth } from '@/lib/finance/budget';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function signIn() {
  const org = await seedOrg(db);
  auth.ctx.orgId = org.id;
  return org;
}

async function seedCategory(orgId: string, name: string) {
  const [row] = await db.insert(schema.expenseCategories).values({ orgId, name }).returning();
  return row.id;
}

async function seedExpense(orgId: string, categoryId: string | null, amount: string, incurredOn: string) {
  await db.insert(schema.expenses).values({ orgId, categoryId, amount, description: 'Gasto', incurredOn });
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('expense budgets (real SQL)', () => {
  it('creates then updates the annual budget of a category', async () => {
    const org = await signIn();
    const categoryId = await seedCategory(org.id, 'Reparaciones');

    expect((await setExpenseBudget(null, form({ category_id: categoryId, year: '2026', amount: '1200' }))).data).toEqual({ saved: true });
    expect((await setExpenseBudget(null, form({ category_id: categoryId, year: '2026', amount: '1500.5' }))).error).toBeUndefined();

    const rows = await db.select().from(schema.expenseBudgets)
      .where(and(eq(schema.expenseBudgets.orgId, org.id), eq(schema.expenseBudgets.categoryId, categoryId)));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(1500.5);
  });

  it('reports budgets for the year and spend grouped by category and month', async () => {
    const org = await signIn();
    const repairs = await seedCategory(org.id, 'Reparaciones');
    const cleaning = await seedCategory(org.id, 'Limpieza');
    await setExpenseBudget(null, form({ category_id: repairs, year: '2026', amount: '1200' }));
    await setExpenseBudget(null, form({ category_id: repairs, year: '2025', amount: '999' }));
    await seedExpense(org.id, repairs, '100.00', '2026-02-03');
    await seedExpense(org.id, repairs, '50.25', '2026-02-20');
    await seedExpense(org.id, null, '30.00', '2026-05-01');
    await seedExpense(org.id, cleaning, '70.00', '2025-12-31');

    expect(await listBudgetCategories(org.id, 2026)).toEqual([
      { categoryId: cleaning, name: 'Limpieza', annualBudget: 0 },
      { categoryId: repairs, name: 'Reparaciones', annualBudget: 1200 },
    ]);
    const spend = await spendByCategoryMonth(org.id, 2026);
    expect(spend).toHaveLength(2);
    expect(spend).toEqual(expect.arrayContaining([
      { categoryId: repairs, month: 2, amount: 150.25 },
      { categoryId: null, month: 5, amount: 30 },
    ]));
  });

  it('refuses categories of another org and invalid input', async () => {
    const other = await signIn();
    const foreignCategory = await seedCategory(other.id, 'Ajena');
    await signIn();

    expect((await setExpenseBudget(null, form({ category_id: foreignCategory, year: '2026', amount: '10' }))).error?.code).toBe('NOT_FOUND');
    expect((await setExpenseBudget(null, form({ category_id: foreignCategory, year: '2026', amount: '-1' }))).error?.code).toBe('VALIDATION_ERROR');
    expect((await setExpenseBudget(null, form({ category_id: 'nope', year: '2026', amount: '10' }))).error?.code).toBe('VALIDATION_ERROR');
    expect(await db.select().from(schema.expenseBudgets).where(eq(schema.expenseBudgets.categoryId, foreignCategory))).toHaveLength(0);
  });
});
