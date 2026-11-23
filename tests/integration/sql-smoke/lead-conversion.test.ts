import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedLead, seedOrg, seedProperty, type SmokeHandle } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', fail: false }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.fail) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedOrgWithLeadAndUnit() {
  const org = await seedOrg(smoke.db);
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db.insert(schema.units)
    .values({ orgId: org.id, propertyId: property.id, label: '101', monthlyRentDefault: '1200' })
    .returning();
  const lead = await seedLead(smoke.db, org.id, { email: 'lead@example.com', phone: '+51900000000' });
  return { org, unit, lead };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function conversionForm(leadId: string, unitId: string, overrides: Record<string, string> = {}) {
  return form({
    lead_id: leadId,
    full_name: 'Lead One',
    email: 'lead@example.com',
    phone: '+51900000000',
    unit_id: unitId,
    start_date: '2026-12-01',
    end_date: '2027-12-01',
    monthly_rent: '1250',
    deposit: '2500',
    ...overrides,
  });
}

describe('convertLeadToTenant (real SQL)', () => {
  it('creates tenant, active contract, occupied unit and conversion link', async () => {
    const { convertLeadToTenant } = await import('@/app/actions/lead-conversion');
    const { org, unit, lead } = await seedOrgWithLeadAndUnit();
    auth.orgId = org.id;
    auth.fail = false;

    const result = await convertLeadToTenant(null, conversionForm(lead.id, unit.id));
    expect(result.error).toBeUndefined();
    const tenantId = result.data!.tenantId;

    const [tenant] = await smoke.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    expect(tenant).toMatchObject({ orgId: org.id, fullName: 'Lead One', unitId: unit.id, email: 'lead@example.com' });

    const [contract] = await smoke.db.select().from(schema.contracts).where(eq(schema.contracts.tenantId, tenantId));
    expect(contract).toMatchObject({ unitId: unit.id, status: 'active', startDate: '2026-12-01', endDate: '2027-12-01' });
    expect(Number(contract.monthlyRent)).toBe(1250);
    expect(Number(contract.deposit)).toBe(2500);

    const [updatedUnit] = await smoke.db.select().from(schema.units).where(eq(schema.units.id, unit.id));
    expect(updatedUnit.status).toBe('occupied');

    const [link] = await smoke.db.select().from(schema.leadConversions).where(eq(schema.leadConversions.leadId, lead.id));
    expect(link).toMatchObject({ orgId: org.id, tenantId, contractId: contract.id });
  });

  it('rejects a second conversion of the same lead', async () => {
    const { convertLeadToTenant } = await import('@/app/actions/lead-conversion');
    const { org, unit, lead } = await seedOrgWithLeadAndUnit();
    auth.orgId = org.id;
    auth.fail = false;

    expect((await convertLeadToTenant(null, conversionForm(lead.id, unit.id))).error).toBeUndefined();
    const second = await convertLeadToTenant(null, conversionForm(lead.id, unit.id));
    expect(second.error?.code).toBe('CONFLICT');

    const tenants = await smoke.db.select().from(schema.tenants).where(eq(schema.tenants.orgId, org.id));
    expect(tenants).toHaveLength(1);
  });

  it('returns NOT_FOUND for a lead or unit of another org', async () => {
    const { convertLeadToTenant } = await import('@/app/actions/lead-conversion');
    const mine = await seedOrgWithLeadAndUnit();
    const other = await seedOrgWithLeadAndUnit();
    auth.orgId = mine.org.id;
    auth.fail = false;

    expect((await convertLeadToTenant(null, conversionForm(other.lead.id, mine.unit.id))).error?.code).toBe('NOT_FOUND');
    expect((await convertLeadToTenant(null, conversionForm(mine.lead.id, other.unit.id))).error?.code).toBe('NOT_FOUND');
    const tenants = await smoke.db.select().from(schema.tenants).where(eq(schema.tenants.orgId, mine.org.id));
    expect(tenants).toHaveLength(0);
  });

  it('validates input and requires an admin', async () => {
    const { convertLeadToTenant } = await import('@/app/actions/lead-conversion');
    const { org, unit, lead } = await seedOrgWithLeadAndUnit();
    auth.orgId = org.id;
    auth.fail = false;

    const invalid = await convertLeadToTenant(null, conversionForm(lead.id, unit.id, { end_date: '2026-11-01' }));
    expect(invalid.error?.code).toBe('VALIDATION_ERROR');

    auth.fail = true;
    const unauthorized = await convertLeadToTenant(null, conversionForm(lead.id, unit.id));
    expect(unauthorized.error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
