/**
 * Real-SQL smoke test for expense sub-categories and the ordinary/extraordinary
 * kind (src/lib/expenses/queries.ts).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';
import { expenseCategories, expenses } from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedCategory(orgId: string, name: string, parentId: string | null = null) {
  const [row] = await smoke.db.insert(expenseCategories).values({ orgId, name, parentId }).returning();
  return row;
}

describe('expense classification (real SQL)', () => {
  it('defaults kind to ordinary and finds categories only within the org', async () => {
    const { findExpenseCategory } = await import('@/lib/expenses/queries');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const parent = await seedCategory(org.id, 'Mantenimiento');
    const child = await seedCategory(org.id, 'Ascensor', parent.id);

    const [expense] = await smoke.db.insert(expenses).values({
      orgId: org.id, amount: '10', description: 'x', incurredOn: '2026-11-01',
    }).returning();
    expect(expense.kind).toBe('ordinary');

    expect(await findExpenseCategory(org.id, child.id)).toEqual({ id: child.id, parentId: parent.id });
    expect(await findExpenseCategory(other.id, child.id)).toBeNull();
  });

  it('lists one month of expenses with parent category, property and kind filter', async () => {
    const { listMonthExpenses } = await import('@/lib/expenses/queries');
    const org = await seedOrg(smoke.db);
    const property = await seedProperty(smoke.db, org.id);
    const parent = await seedCategory(org.id, 'Servicios');
    const child = await seedCategory(org.id, 'Agua', parent.id);

    await smoke.db.insert(expenses).values([
      { orgId: org.id, propertyId: property.id, categoryId: child.id, amount: '50', description: 'agua', incurredOn: '2026-12-31' },
      { orgId: org.id, amount: '900', description: 'techo', incurredOn: '2026-12-02', kind: 'extraordinary' },
      { orgId: org.id, amount: '1', description: 'otro mes', incurredOn: '2027-01-01' },
    ]);

    const december = await listMonthExpenses(org.id, '2026-12');
    expect(december.map((row) => row.description)).toEqual(['agua', 'techo']);
    expect(december[0]).toMatchObject({ categoryName: 'Agua', parentCategoryName: 'Servicios', propertyName: property.name, kind: 'ordinary' });

    const extraordinary = await listMonthExpenses(org.id, '2026-12', 'extraordinary');
    expect(extraordinary.map((row) => row.description)).toEqual(['techo']);
  });

  it('sets a child parent_id to null when its parent is deleted', async () => {
    const org = await seedOrg(smoke.db);
    const parent = await seedCategory(org.id, 'Padre');
    const child = await seedCategory(org.id, 'Hijo', parent.id);

    await smoke.db.delete(expenseCategories).where(eq(expenseCategories.id, parent.id));
    const [row] = await smoke.db.select().from(expenseCategories).where(eq(expenseCategories.id, child.id));
    expect(row.parentId).toBeNull();
  });
});
