import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { chunk, rowsPerInsert } from '@/lib/db/batch';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string }, forbidden: false }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (authBox.forbidden) throw new Error('FORBIDDEN');
    if (!authBox.ctx) throw new Error('UNAUTHORIZED');
    return authBox.ctx;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { loadPropertyUtilities, CONTRACTS_PAGE_SIZE } = await import('@/lib/utility-contracts/queries');
const actions = await import('@/app/actions/utility-contracts');

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
  authBox.forbidden = false;
});

function formOf(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function seedUnit(orgId: string, propertyId: string, label = 'U-1') {
  const [unit] = await smoke.db.insert(schema.units)
    .values({ id: crypto.randomUUID(), orgId, propertyId, label, createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return unit;
}

async function signIn() {
  const org = await seedOrg(smoke.db);
  authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
  return org;
}

const contractForm = (propertyId: string, extra: Record<string, string> = {}) => formOf({
  property_id: propertyId,
  utility_type: 'luz',
  provider: 'Luz del Sur',
  supply_number: '123456',
  monthly_estimate: '120',
  start_date: '2026-01-15',
  holder_kind: 'owner',
  holder_name: 'Ana Owner',
  ...extra,
});

async function seedForeignContract() {
  const other = await seedOrg(smoke.db);
  const property = await seedProperty(smoke.db, other.id);
  const [contract] = await smoke.db.insert(schema.utilityContracts).values({
    orgId: other.id, propertyId: property.id, utilityType: 'agua', provider: 'Sedapal', holderKind: 'owner', holderName: 'Foreign',
  }).returning();
  return { property, contract };
}

describe('auth', () => {
  it('returns UNAUTHORIZED for anonymous callers and FORBIDDEN for non-admins on every action', async () => {
    const id = crypto.randomUUID();
    const calls = [
      () => actions.createUtilityContract({}, contractForm(id)),
      () => actions.editUtilityContract({}, formOf({ id, utility_type: 'luz', provider: 'X' })),
      () => actions.changeUtilityHolder({}, formOf({ id, holder_kind: 'tenant', holder_name: 'X', changed_on: '2026-11-01' })),
      () => actions.removeUtilityContract({}, formOf({ id })),
    ];
    for (const call of calls) expect((await call()).error?.code).toBe('UNAUTHORIZED');
    authBox.forbidden = true;
    for (const call of calls) expect((await call()).error?.code).toBe('FORBIDDEN');
  });
});

describe('createUtilityContract', () => {
  it('validates input server-side', async () => {
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    const result = await actions.createUtilityContract({}, contractForm(property.id, { utility_type: 'cable' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a property or unit from another org, and a unit of another property', async () => {
    const other = await seedOrg(smoke.db);
    const foreignProperty = await seedProperty(smoke.db, other.id);
    const foreignUnit = await seedUnit(other.id, foreignProperty.id);
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    const sibling = await seedProperty(smoke.db, org.id);
    const siblingUnit = await seedUnit(org.id, sibling.id);

    expect((await actions.createUtilityContract({}, contractForm(foreignProperty.id))).error?.code).toBe('NOT_FOUND');
    expect((await actions.createUtilityContract({}, contractForm(property.id, { unit_id: foreignUnit.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.createUtilityContract({}, contractForm(property.id, { unit_id: siblingUnit.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('creates property- and unit-level contracts and lists them newest first', async () => {
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    const unit = await seedUnit(org.id, property.id, 'A-101');

    expect((await actions.createUtilityContract({}, contractForm(property.id))).error).toBeUndefined();
    expect((await actions.createUtilityContract({}, contractForm(property.id, {
      utility_type: 'gas', provider: 'Calidda', unit_id: unit.id, monthly_estimate: '', start_date: '',
    }))).error).toBeUndefined();

    const data = await loadPropertyUtilities(org.id, property.id, 1);
    expect(data?.property.id).toBe(property.id);
    expect(data?.units.map((u) => u.label)).toEqual(['A-101']);
    const byType = Object.fromEntries(data!.contracts.map((c) => [c.utilityType, c]));
    expect(byType.luz).toMatchObject({ provider: 'Luz del Sur', supplyNumber: '123456', monthlyEstimate: '120.00', startDate: '2026-01-15', unitLabel: null });
    expect(byType.gas).toMatchObject({ provider: 'Calidda', unitLabel: 'A-101', monthlyEstimate: null, startDate: null });
  });
});

describe('loadPropertyUtilities', () => {
  it('returns null for another org property', async () => {
    const { property } = await seedForeignContract();
    const org = await signIn();
    expect(await loadPropertyUtilities(org.id, property.id, 1)).toBeNull();
  });

  it('paginates contracts', async () => {
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    const base = Date.now();
    const rows = Array.from({ length: CONTRACTS_PAGE_SIZE + 2 }, (_, i) => ({
      orgId: org.id, propertyId: property.id, utilityType: 'otro', provider: `P${i}`, holderKind: 'other', holderName: 'X',
      createdAt: new Date(base + i), updatedAt: new Date(base + i),
    }));
    for (const batch of chunk(rows, rowsPerInsert(schema.utilityContracts))) {
      await smoke.db.insert(schema.utilityContracts).values(batch);
    }

    const first = await loadPropertyUtilities(org.id, property.id, 1);
    const second = await loadPropertyUtilities(org.id, property.id, 2);
    expect(first?.contracts).toHaveLength(CONTRACTS_PAGE_SIZE);
    expect(first?.hasMore).toBe(true);
    expect(second?.contracts.map((c) => c.provider)).toEqual(['P1', 'P0']);
    expect(second?.hasMore).toBe(false);
  });
});

describe('editUtilityContract', () => {
  it('updates own contracts but not the holder, and rejects foreign ones', async () => {
    const { contract: foreign } = await seedForeignContract();
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    await actions.createUtilityContract({}, contractForm(property.id));
    const [contract] = (await loadPropertyUtilities(org.id, property.id, 1))!.contracts;

    const edit = { id: contract.id, utility_type: 'luz', provider: 'Enel', supply_number: '999', holder_name: 'Hacker' };
    expect((await actions.editUtilityContract({}, formOf(edit))).error).toBeUndefined();
    const [updated] = (await loadPropertyUtilities(org.id, property.id, 1))!.contracts;
    expect(updated).toMatchObject({ provider: 'Enel', supplyNumber: '999', holderName: 'Ana Owner', monthlyEstimate: null });

    expect((await actions.editUtilityContract({}, formOf({ ...edit, id: foreign.id }))).error?.code).toBe('NOT_FOUND');
    const [untouched] = await smoke.db.select().from(schema.utilityContracts).where(eq(schema.utilityContracts.id, foreign.id));
    expect(untouched.provider).toBe('Sedapal');
  });
});

describe('changeUtilityHolder', () => {
  it('updates the holder and logs from/to, rejecting foreign contracts', async () => {
    const { contract: foreign } = await seedForeignContract();
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    await actions.createUtilityContract({}, contractForm(property.id));
    const [contract] = (await loadPropertyUtilities(org.id, property.id, 1))!.contracts;

    const change = { id: contract.id, holder_kind: 'tenant', holder_name: 'Juan Tenant', changed_on: '2026-03-01', reason: 'Ingreso de inquilino' };
    expect((await actions.changeUtilityHolder({}, formOf(change))).error).toBeUndefined();
    expect((await actions.changeUtilityHolder({}, formOf({ ...change, holder_kind: 'owner', holder_name: 'Ana Owner', changed_on: '2026-09-01', reason: '' }))).error).toBeUndefined();

    const [updated] = (await loadPropertyUtilities(org.id, property.id, 1))!.contracts;
    expect(updated).toMatchObject({ holderKind: 'owner', holderName: 'Ana Owner' });
    expect(updated.changes.map((c) => [c.changedOn, c.fromHolder, c.toHolder, c.reason])).toEqual([
      ['2026-09-01', 'Juan Tenant', 'Ana Owner', null],
      ['2026-03-01', 'Ana Owner', 'Juan Tenant', 'Ingreso de inquilino'],
    ]);

    expect((await actions.changeUtilityHolder({}, formOf({ ...change, id: foreign.id }))).error?.code).toBe('NOT_FOUND');
    expect(await smoke.db.select().from(schema.utilityHolderChanges).where(eq(schema.utilityHolderChanges.contractId, foreign.id))).toHaveLength(0);
  });
});

describe('removeUtilityContract', () => {
  it('deletes own contracts with their log, never foreign ones', async () => {
    const { contract: foreign } = await seedForeignContract();
    const org = await signIn();
    const property = await seedProperty(smoke.db, org.id);
    await actions.createUtilityContract({}, contractForm(property.id));
    const [contract] = (await loadPropertyUtilities(org.id, property.id, 1))!.contracts;
    await actions.changeUtilityHolder({}, formOf({ id: contract.id, holder_kind: 'tenant', holder_name: 'J', changed_on: '2026-03-01' }));

    expect((await actions.removeUtilityContract({}, formOf({ id: foreign.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.removeUtilityContract({}, formOf({ id: contract.id }))).error).toBeUndefined();
    expect((await loadPropertyUtilities(org.id, property.id, 1))!.contracts).toHaveLength(0);
    expect(await smoke.db.select().from(schema.utilityHolderChanges).where(eq(schema.utilityHolderChanges.contractId, contract.id))).toHaveLength(0);
    expect(await smoke.db.select().from(schema.utilityContracts).where(eq(schema.utilityContracts.id, foreign.id))).toHaveLength(1);
  });
});
