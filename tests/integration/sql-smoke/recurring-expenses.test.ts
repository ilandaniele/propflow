import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (!authBox.ctx) throw new Error('unauthorized');
    return authBox.ctx;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { generateRecurringExpenses, listRecurringExpenses } = await import('@/lib/recurring-expenses/queries');
const actions = await import('@/app/actions/recurring-expenses');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  authBox.ctx = null;
});

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('generateRecurringExpenses', () => {
  it('creates one expense per active template and never twice per period', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const property = await seedProperty(db, org.id);
    await db.insert(schema.recurringExpenses).values([
      { orgId: org.id, propertyId: property.id, amount: '350.00', description: 'Vigilancia', dayOfMonth: 5 },
      { orgId: org.id, amount: '99.90', description: 'Internet', dayOfMonth: 28, lastPeriod: '2026-10' },
      { orgId: org.id, amount: '10.00', description: 'Pausado', dayOfMonth: 1, active: false },
      { orgId: org.id, amount: '10.00', description: 'Ya generado', dayOfMonth: 1, lastPeriod: '2026-11' },
      { orgId: other.id, amount: '10.00', description: 'Ajeno', dayOfMonth: 1 },
    ]);

    expect(await generateRecurringExpenses(org.id, '2026-11')).toBe(2);
    expect(await generateRecurringExpenses(org.id, '2026-11')).toBe(0);

    const created = await db.select().from(schema.expenses).where(eq(schema.expenses.orgId, org.id));
    expect(created.map((e) => [e.description, e.amount, e.incurredOn, e.propertyId]).sort()).toEqual([
      ['Internet', '99.90', '2026-11-28', null],
      ['Vigilancia', '350.00', '2026-11-05', property.id],
    ]);
    for (const e of created) {
      expect(e.id).toMatch(GUID);
      expect(e.createdAt).toBeInstanceOf(Date);
    }
    expect(await db.select().from(schema.expenses).where(eq(schema.expenses.orgId, other.id))).toHaveLength(0);

    const templates = await listRecurringExpenses(org.id);
    expect(templates.find((r) => r.description === 'Vigilancia')?.lastPeriod).toBe('2026-11');
    expect(templates.find((r) => r.description === 'Pausado')?.lastPeriod).toBeNull();

    expect(await generateRecurringExpenses(org.id, '2026-12')).toBe(3);
  });
});

describe('recurring expense actions', () => {
  it('rejects unauthenticated callers', async () => {
    const result = await actions.createRecurringExpense({}, form({ description: 'x', amount: '1', day_of_month: '1' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('creates, pauses and deletes within the org only', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const foreignProperty = await seedProperty(db, other.id);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.createRecurringExpense({}, form({ description: 'Luz común', amount: '120', day_of_month: '10', property_id: '', category_id: '' }))).error).toBeUndefined();
    expect((await actions.createRecurringExpense({}, form({ description: 'x', amount: '1', day_of_month: '31' }))).error?.code).toBe('VALIDATION_ERROR');
    expect((await actions.createRecurringExpense({}, form({ description: 'x', amount: '1', day_of_month: '1', property_id: foreignProperty.id }))).error?.code).toBe('NOT_FOUND');

    const [row] = await listRecurringExpenses(org.id);
    expect(row).toMatchObject({ description: 'Luz común', amount: '120', dayOfMonth: 10, active: true });

    expect((await actions.toggleRecurringExpense({}, form({ id: row.id, active: 'false' }))).error).toBeUndefined();
    expect((await listRecurringExpenses(org.id))[0].active).toBe(false);

    authBox.ctx = { userId: crypto.randomUUID(), orgId: other.id };
    expect((await actions.removeRecurringExpense({}, form({ id: row.id }))).error?.code).toBe('NOT_FOUND');

    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
    expect((await actions.removeRecurringExpense({}, form({ id: row.id }))).error).toBeUndefined();
    expect(await listRecurringExpenses(org.id)).toHaveLength(0);
  });
});
