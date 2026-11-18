import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { db as appDb } from '@/lib/db';
import { assertMigrated, createSmokeDb, readMigrations, seedLead, seedOrg, type SmokeHandle } from './setup';

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
});

afterAll(async () => {
  await smoke?.close();
});

describe('sql-smoke harness (local D1)', () => {
  it('applies every journal migration', async () => {
    await assertMigrated(smoke.db);
    const objects = await smoke.db.execute<{ type: string; name: string }>(
      sql`SELECT type, name FROM sqlite_master WHERE name IN ('organizations', 'crm_leads', 'agent_jobs', 'property_visits_no_overlap_insert', 'tenant_statement')`,
    );
    expect(objects.map((o) => `${o.type}:${o.name}`).sort()).toEqual([
      'table:agent_jobs',
      'table:crm_leads',
      'table:organizations',
      'trigger:property_visits_no_overlap_insert',
      'view:tenant_statement',
    ]);
    expect(readMigrations().map((m) => m.tag)).toEqual(['0000_init', '0001_triggers', '0002_dashboard_kpi_indexes']);
  });

  it('enforces foreign keys', async () => {
    const [{ foreign_keys }] = await smoke.db.execute<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(foreign_keys).toBe(1);
  });

  it('round-trips a seed with app-generated id and ms timestamps', async () => {
    const before = Date.now();
    const org = await seedOrg(smoke.db, { name: 'Round Trip' });
    const lead = await seedLead(smoke.db, org.id, { fullName: 'Ana' });

    const [raw] = await smoke.db.execute<{ id: string; created_at: number; updated_at: number }>(
      sql`SELECT id, created_at, updated_at FROM crm_leads WHERE id = ${lead.id}`,
    );
    expect(raw.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw.created_at).toBeGreaterThanOrEqual(before);
    expect(raw.updated_at).toBe(raw.created_at);

    const [read] = await smoke.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(read).toMatchObject({ orgId: org.id, fullName: 'Ana', status: 'new' });
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it('wires the app `db` from @/lib/db to the same D1', async () => {
    const org = await seedOrg(smoke.db, { name: 'Via app db' });
    const rows = await appDb.execute<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${org.id}`);
    expect(rows).toEqual([{ name: 'Via app db' }]);
  });
});
