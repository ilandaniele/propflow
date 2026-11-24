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
    expect(readMigrations().map((m) => m.tag)).toEqual([
      '0000_init',
      '0001_triggers',
      '0002_dashboard_kpi_indexes',
      '0003_listings_published_at_keep_value',
      '0004_pg_legacy_columns',
      '0005_profile_id_equals_user_id',
      '0006_lead_conversions',
      '0007_amenities',
      '0008_assets',
      '0009_bank_reconciliation',
      '0010_cash_accounts',
      '0011_deposit_movements',
      '0012_expense_budgets',
      '0013_expenses_currency',
      '0014_incident_schedules',
      '0015_org_branding',
      '0016_org_signatures',
      '0017_owner_assistant',
      '0018_owner_terms',
      '0019_rent_adjustments',
      '0020_rental_applications',
      '0021_staff_roles',
      '0022_suppliers',
      '0023_activity_events',
      '0024_announcement_flags',
      '0025_building_staff',
      '0026_expense_classification',
      '0027_expiring_documents',
      '0028_incident_status_events',
      '0029_org_memberships',
      '0030_owner_portal_links',
      '0031_period_closes',
      '0032_public_api_keys',
      '0033_recurring_expenses',
      '0034_resident_polls',
      '0035_signature_evidence',
      '0036_tenant_messages',
      '0037_visitor_access',
      '0038_einvoices',
      '0039_handover_acts',
      '0040_notification_preferences',
      '0041_payables',
      '0042_payment_intents',
      '0043_property_groups',
      '0044_rent_schedule',
      '0045_unit_beds',
      '0046_unit_calendars',
      '0047_documents',
    ]);
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
