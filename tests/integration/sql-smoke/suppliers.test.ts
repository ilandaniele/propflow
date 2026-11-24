import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeHandle } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', userId: '' }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({ userId: auth.userId, orgId: auth.orgId, role: 'admin', profile: {} })),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: SmokeHandle;
let actions: typeof import('@/app/actions/suppliers');
let lib: typeof import('@/lib/suppliers/suppliers');

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
  actions = await import('@/app/actions/suppliers');
  lib = await import('@/lib/suppliers/suppliers');
});

afterAll(async () => {
  await smoke.close();
});

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

async function seedAdminOrg(name: string) {
  const org = await seedOrg(smoke.db, { name });
  const admin = await seedProfile(smoke.db, org.id, { email: `${name}@example.com` });
  const [incident] = await smoke.db
    .insert(schema.incidents)
    .values({ orgId: org.id, category: 'plumbing', title: 'Leak', description: 'Kitchen leak', status: 'pending' })
    .returning();
  return { org, admin, incident };
}

function actAs(org: { id: string }, admin: { id: string }) {
  auth.orgId = org.id;
  auth.userId = admin.id;
}

describe('supplier actions (real SQL)', () => {
  it('creates, edits, assigns and tracks a supplier job', async () => {
    const { org, admin, incident } = await seedAdminOrg('alpha');
    actAs(org, admin);

    expect((await actions.createSupplier(null, form({ name: 'Luis', trade: 'plumbing', phone: '999 111 222' }))).error).toBeUndefined();
    const [supplier] = await lib.listSuppliers(org.id);
    expect(supplier).toMatchObject({ name: 'Luis', trade: 'plumbing', active: true, totalJobs: 0 });

    expect((await actions.updateSupplier(null, form({ id: supplier.id, name: 'Luis R.', trade: 'plumbing' }))).error).toBeUndefined();
    expect((await actions.assignSupplierToIncident(null, form({ incident_id: incident.id, supplier_id: supplier.id }))).error).toBeUndefined();
    expect((await actions.updateSupplierAssignment(null, form({ incident_id: incident.id, status: 'quoted', quote_amount: '180' }))).error).toBeUndefined();

    expect(await lib.incidentAssignment(org.id, incident.id)).toMatchObject({ supplierName: 'Luis R.', status: 'quoted', quoteAmount: '180.00', finalCost: null });
    const [listed] = await lib.listSuppliers(org.id);
    expect(listed).toMatchObject({ openJobs: 1, totalJobs: 1 });

    const [incidentRow] = await smoke.db.select({ cost: schema.incidents.cost }).from(schema.incidents).where(eq(schema.incidents.id, incident.id));
    expect(incidentRow.cost).toBeNull();
  });

  it('reassigning resets the quote, and inactive suppliers cannot be assigned', async () => {
    const { org, admin, incident } = await seedAdminOrg('beta');
    actAs(org, admin);
    await actions.createSupplier(null, form({ name: 'Ana', trade: 'electrical' }));
    await actions.createSupplier(null, form({ name: 'Beto', trade: 'electrical' }));
    const [ana, beto] = await lib.listSuppliers(org.id);

    await actions.assignSupplierToIncident(null, form({ incident_id: incident.id, supplier_id: ana.id }));
    await actions.updateSupplierAssignment(null, form({ incident_id: incident.id, status: 'approved', quote_amount: '90' }));
    await actions.assignSupplierToIncident(null, form({ incident_id: incident.id, supplier_id: beto.id }));
    expect(await lib.incidentAssignment(org.id, incident.id)).toMatchObject({ supplierName: 'Beto', status: 'assigned', quoteAmount: null });

    expect((await actions.setSupplierActive(null, form({ id: ana.id, active: 'false' }))).error).toBeUndefined();
    expect((await lib.activeSupplierOptions(org.id)).map((option) => option.name)).toEqual(['Beto']);
    expect((await actions.assignSupplierToIncident(null, form({ incident_id: incident.id, supplier_id: ana.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('blocks cross-org access to suppliers and incidents', async () => {
    const alpha = await seedAdminOrg('gamma');
    const other = await seedAdminOrg('delta');
    actAs(other.org, other.admin);
    await actions.createSupplier(null, form({ name: 'Foreign', trade: 'general' }));
    const [foreign] = await lib.listSuppliers(other.org.id);

    actAs(alpha.org, alpha.admin);
    expect((await actions.updateSupplier(null, form({ id: foreign.id, name: 'Hijack', trade: 'general' }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.setSupplierActive(null, form({ id: foreign.id, active: 'false' }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.assignSupplierToIncident(null, form({ incident_id: alpha.incident.id, supplier_id: foreign.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.assignSupplierToIncident(null, form({ incident_id: other.incident.id, supplier_id: foreign.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.updateSupplierAssignment(null, form({ incident_id: other.incident.id, status: 'done' }))).error?.code).toBe('NOT_FOUND');
    expect(await lib.listSuppliers(alpha.org.id)).toEqual([]);
  });
});
