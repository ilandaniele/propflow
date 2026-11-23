import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedLead, seedOrg, seedProfile, seedProperty, seedVisit, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const { listCalendarEvents } = await import('@/lib/ops-calendar/events');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedContract(db: SmokeDb, orgId: string, values: { startDate: string; endDate: string; status?: string }) {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({ orgId, propertyId: property.id, label: '301' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId, fullName: 'Ana Ruiz', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId, tenantId: tenant.id, unitId: unit.id, monthlyRent: '1000', ...values })
    .returning();
  return { unit, tenant, contract };
}

describe('listCalendarEvents', () => {
  it('collects every event kind in range, scoped to the org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const { unit, tenant, contract } = await seedContract(db, org.id, { startDate: '2026-03-05', endDate: '2026-03-31' });
    await seedContract(db, org.id, { startDate: '2026-03-06', endDate: '2026-03-30', status: 'terminated' });
    await seedContract(db, other.id, { startDate: '2026-03-07', endDate: '2026-03-29' });

    for (const dueDate of ['2026-03-10', '2026-03-10', '2026-04-10']) {
      await db.insert(schema.charges).values({ orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '1000', dueDate });
    }
    await db.insert(schema.cleaningTasks).values([
      { orgId: org.id, unitId: unit.id, title: 'Pasillo', scheduledDate: '2026-03-12' },
      { orgId: org.id, unitId: unit.id, title: 'Hecha', scheduledDate: '2026-03-12', status: 'done' },
    ]);

    const profile = await seedProfile(db, org.id);
    const lead = await seedLead(db, org.id, { fullName: 'Luis Lead' });
    const visit = (startsAt: string, status = 'scheduled') => seedVisit(db, org.id, {
      leadId: lead.id, profileId: profile.id, status, startsAt: new Date(startsAt),
      endsAt: new Date(Date.parse(startsAt) + 1_800_000), blockedUntil: new Date(Date.parse(startsAt) + 1_800_000),
      sourceChannel: 'manual', createdBy: 'human',
    });
    await visit('2026-03-01T02:00:00Z');
    await visit('2026-03-20T15:00:00Z');
    await visit('2026-03-21T15:00:00Z', 'cancelled');

    const events = await listCalendarEvents(org.id, '2026-03-01', '2026-04-01');

    expect(events.map((e) => [e.kind, e.day])).toEqual([
      ['contract_start', '2026-03-05'],
      ['charge_due', '2026-03-10'],
      ['cleaning', '2026-03-12'],
      ['visit', '2026-03-20'],
      ['contract_end', '2026-03-31'],
    ]);
    expect(events.find((e) => e.kind === 'charge_due')?.count).toBe(2);
    expect(events.find((e) => e.kind === 'contract_end')).toMatchObject({ label: 'Ana Ruiz', detail: '301' });
    expect(events.find((e) => e.kind === 'visit')).toMatchObject({ label: 'Luis Lead', startAt: Date.parse('2026-03-20T15:00:00Z') });
  });
});
