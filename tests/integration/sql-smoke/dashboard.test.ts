/**
 * Real-SQL smoke test for src/lib/dashboard/queries.ts on local D1 (W-CF-37):
 * the admin dashboard KPI statement, the tenants-list overdue aggregate, the
 * tenant statement, the leads board and the CSV import log. Two orgs are
 * seeded; org B's numbers are large so any cross-org leakage shows up in org
 * A's totals.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedLead, seedSession, seedProperty, type SmokeDb } from './setup';

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

const NOW = new Date(2026, 10, 15, 12);

async function seedFinanceOrg(db: SmokeDb, scale: number) {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id);
  const [occupied] = await db.insert(schema.units)
    .values([
      { orgId: org.id, propertyId: property.id, label: 'A1', status: 'occupied' },
      { orgId: org.id, propertyId: property.id, label: 'A2', status: 'vacant' },
    ])
    .returning();
  const [debtor, current] = await db.insert(schema.tenants)
    .values([
      { orgId: org.id, fullName: 'Debtor', unitId: occupied.id },
      { orgId: org.id, fullName: 'Up To Date' },
    ])
    .returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: debtor.id, unitId: occupied.id, startDate: '2026-01-01', monthlyRent: '1000.00' })
    .returning();
  const owed = { orgId: org.id, contractId: contract.id, tenantId: debtor.id };
  await db.insert(schema.charges).values({ ...owed, amount: String(1000 * scale), dueDate: '2020-01-01' });
  await db.insert(schema.payments).values([
    { ...owed, amount: String(300 * scale), paidAt: '2026-11-05', status: 'approved' },
    { ...owed, amount: String(200 * scale), paidAt: '2026-12-02', status: 'approved' },
    { ...owed, amount: String(100 * scale), paidAt: '2026-11-06', status: 'pending' },
    { ...owed, amount: String(50 * scale), paidAt: '2026-10-20', status: 'approved' },
  ]);
  await db.insert(schema.expenses).values([
    { orgId: org.id, amount: String(120 * scale), description: 'Paint', incurredOn: '2026-11-03' },
    { orgId: org.id, amount: String(999 * scale), description: 'Old', incurredOn: '2026-10-01' },
  ]);
  await db.insert(schema.incidents).values([
    { orgId: org.id, category: 'plumbing', title: 'Leak', description: 'Leak', status: 'pending' },
    { orgId: org.id, category: 'other', title: 'Done', description: 'Done', status: 'solved' },
  ]);
  await db.insert(schema.additionalCharges).values([
    { orgId: org.id, amount: String(40 * scale), anio: 2026 },
    { orgId: org.id, amount: String(10 * scale), anio: 2025 },
  ]);
  await db.insert(schema.accountStatements).values([
    { orgId: org.id, sendStatus: 'sent' },
    { orgId: org.id, sendStatus: null },
    { orgId: org.id, sendStatus: 'pending' },
  ]);
  await db.insert(schema.tenantFeedback).values({ orgId: org.id, cleaningScore: 4, valueScore: 2 });
  await db.insert(schema.trashCompliance).values([
    { orgId: org.id, fecha: '2026-11-02', estado: 'ok' },
    { orgId: org.id, fecha: '2026-11-09', estado: 'ok' },
    { orgId: org.id, fecha: '2026-10-01', estado: 'missed' },
  ]);
  return { org, debtor, current };
}

describe('dashboard queries (real SQL)', () => {
  it('computes every KPI for one org in one statement, without leaking the other org', async () => {
    const { getDashboardKpis, getOrgOverdueSummary } = await import('@/lib/dashboard/queries');
    const a = await seedFinanceOrg(smoke.db, 1);
    await seedFinanceOrg(smoke.db, 100);

    expect(await getDashboardKpis(a.org.id, NOW)).toEqual({
      totalUnits: 2,
      occupiedUnits: 1,
      rentCollected: 300,
      mtdIncome: 500,
      mtdExpenses: 120,
      openIncidents: 1,
      overdueCount: 1,
      pastDue: 1000 - 550,
      additionalChargesTotal: 40,
      pendingStatements: 2,
      avgFeedback: 3,
      entityCounts: { tenants: 2, properties: 1, payments: 4, contracts: 1 },
      contractTypes: [{ contractType: 'unknown', count: 1 }],
      trashCompliance: [{ estado: 'ok', count: 2 }],
    });
    expect(await getOrgOverdueSummary(a.org.id)).toEqual({ overdueCount: 1, pastDue: 450 });
  });

  it('returns zeroed KPIs and empty breakdowns for an org with no data', async () => {
    const { getDashboardKpis } = await import('@/lib/dashboard/queries');
    const empty = await seedOrg(smoke.db);
    const kpis = await getDashboardKpis(empty.id, NOW);
    expect(kpis.totalUnits).toBe(0);
    expect(kpis.pastDue).toBe(0);
    expect(kpis.avgFeedback).toBeNull();
    expect(kpis.contractTypes).toEqual([]);
    expect(kpis.trashCompliance).toEqual([]);
  });

  it('reads one tenant statement scoped to its org, with a boolean is_overdue', async () => {
    const { getTenantStatement } = await import('@/lib/dashboard/queries');
    const a = await seedFinanceOrg(smoke.db, 1);
    const b = await seedFinanceOrg(smoke.db, 100);

    expect(await getTenantStatement(a.org.id, a.debtor.id)).toEqual({
      total_charges: 1000,
      total_approved_payments: 550,
      balance: -450,
      is_overdue: true,
    });
    expect(await getTenantStatement(a.org.id, a.current.id)).toEqual({
      total_charges: 0,
      total_approved_payments: 0,
      balance: 0,
      is_overdue: false,
    });
    expect(await getTenantStatement(a.org.id, b.debtor.id)).toBeNull();
  });

  it('filters the leads board by org, pipeline, advisor and a literal, case-insensitive search', async () => {
    const q = await import('@/lib/dashboard/queries');
    const orgA = await seedOrg(smoke.db);
    const orgB = await seedOrg(smoke.db);
    const advisor = await seedProfile(smoke.db, orgA.id);
    const ana = await seedLead(smoke.db, orgA.id, { fullName: 'Ana 50%_off', stage: 'new', updatedAt: new Date(2026, 10, 2) });
    await seedLead(smoke.db, orgA.id, { fullName: 'Bob', phone: '+51999', stage: 'qualified', assignedProfileId: advisor.id, updatedAt: new Date(2026, 10, 3) });
    await seedLead(smoke.db, orgA.id, { fullName: 'Ana Supply', pipeline: 'supply' });
    const otherAna = await seedLead(smoke.db, orgB.id, { fullName: 'Ana Other Org' });
    await seedSession(smoke.db, orgA.id, { leadId: ana.id, updatedAt: new Date(2026, 10, 1) });
    const latest = await seedSession(smoke.db, orgA.id, { leadId: ana.id, updatedAt: new Date(2026, 10, 4) });
    await seedSession(smoke.db, orgB.id, { leadId: otherAna.id });

    const board = (advisorParam: string, search: string) =>
      q.leadBoardWhere({ orgId: orgA.id, pipeline: 'demand', advisor: advisorParam, q: search });
    const names = async (advisorParam: string, search: string) =>
      (await q.getLeadCards(board(advisorParam, search), 1000)).map((l) => l.fullName);

    expect(await names('all', '')).toEqual(['Bob', 'Ana 50%_off']);
    expect(await names('all', 'ANA')).toEqual(['Ana 50%_off']);
    expect(await names('all', '0%_')).toEqual(['Ana 50%_off']);
    expect(await names('all', '%')).toEqual(['Ana 50%_off']);
    expect(await names('all', '_')).toEqual(['Ana 50%_off']);
    expect(await names('all', '999')).toEqual(['Bob']);
    expect(await names('unassigned', '')).toEqual(['Ana 50%_off']);
    expect(await names(advisor.id, '')).toEqual(['Bob']);

    const counts = await q.getLeadStageCounts(board('all', ''));
    expect(Object.fromEntries(counts.map((c) => [c.stage, c.count]))).toEqual({ new: 1, qualified: 1 });

    const sessions = await q.getLatestSessionByLead(orgA.id, board('all', ''), 1000);
    expect([...sessions]).toEqual([[ana.id, latest.id]]);
  });

  it('pages the CSV import log for one org with an optional status filter', async () => {
    const { listCsvImports } = await import('@/lib/dashboard/queries');
    const orgA = await seedOrg(smoke.db);
    const orgB = await seedOrg(smoke.db);
    const adminA = await seedProfile(smoke.db, orgA.id);
    const adminB = await seedProfile(smoke.db, orgB.id);
    const row = (orgId: string, createdBy: string, status: string, day: number, originalFilename: string) => ({
      orgId, createdBy, status, originalFilename, importType: 'monthly_billed', period: '2026-11', createdAt: new Date(2026, 10, day),
    });
    await smoke.db.insert(schema.csvImports).values([
      row(orgA.id, adminA.id, 'committed', 1, 'old.csv'),
      row(orgA.id, adminA.id, 'committed', 2, 'new.csv'),
      row(orgA.id, adminA.id, 'failed', 3, 'bad.csv'),
      row(orgB.id, adminB.id, 'committed', 4, 'other.csv'),
    ]);

    const committed = await listCsvImports(orgA.id, 'committed', 0, 1);
    expect(committed.total).toBe(2);
    expect(committed.rows.map((r) => r.originalFilename)).toEqual(['new.csv']);

    const secondPage = await listCsvImports(orgA.id, 'committed', 1, 1);
    expect(secondPage.rows.map((r) => r.originalFilename)).toEqual(['old.csv']);

    const all = await listCsvImports(orgA.id, '', 0, 10);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.originalFilename)).toEqual(['bad.csv', 'new.csv', 'old.csv']);
  });
});
