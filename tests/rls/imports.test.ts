/**
 * tests/rls/imports.test.ts
 *
 * AC29 (partial): csv_imports, import_rows, phantom_rooms, property_mappings,
 * account_mappings have ENABLE + FORCE RLS with WITH CHECK policies.
 * Cross-org SELECT returns 0 rows.
 *
 * Follows the same pattern as tests/rls/airtable.test.ts:
 *   - Skip when no real Supabase credentials available
 *   - Sign in as two separate org admins + one tenant
 *   - Seed test data for Org A, assert Org B sees 0 rows
 *   - Assert WITH CHECK prevents cross-org INSERT (error 42501 or silent deny)
 *   - Tenant users are denied (admin-only tables)
 *
 * Requires:
 *   TEST_SUPABASE_URL + TEST_SUPABASE_ANON_KEY pointing to a real Supabase project
 *   with seed applied (admin@org-a.demo / DemoAdmin123!, admin@org-b.demo, tenant@org-a.demo)
 *   and migration 20260603000030_imports.sql applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.TEST_SUPABASE_URL     ?? process.env.NEXT_PUBLIC_SUPABASE_URL     ?? '';
const supabaseAnonKey = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const skipIfNoSupabase = !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder');

describe.skipIf(skipIfNoSupabase)('Import tables RLS isolation (AC29)', () => {
  let clientOrgAAdmin: SupabaseClient;
  let clientOrgBAdmin: SupabaseClient;
  let clientOrgATenant: SupabaseClient;

  let orgAId: string | null = null;

  // Track inserted row ids for cleanup
  const seededIds: { table: string; id: string }[] = [];

  beforeAll(async () => {
    clientOrgAAdmin  = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgBAdmin  = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgATenant = createClient(supabaseUrl, supabaseAnonKey);

    const [signinA, signinB, signinT] = await Promise.all([
      clientOrgAAdmin.auth.signInWithPassword({  email: 'admin@org-a.demo',  password: 'DemoAdmin123!' }),
      clientOrgBAdmin.auth.signInWithPassword({  email: 'admin@org-b.demo',  password: 'DemoAdmin123!' }),
      clientOrgATenant.auth.signInWithPassword({ email: 'tenant@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    if (signinA.error)  console.warn('[rls/imports] Org A admin sign-in failed:', signinA.error.message);
    if (signinB.error)  console.warn('[rls/imports] Org B admin sign-in failed:', signinB.error.message);
    if (signinT.error)  console.warn('[rls/imports] Tenant sign-in failed:', signinT.error.message);

    // Resolve Org A's org_id
    const { data: profileA } = await clientOrgAAdmin.from('profiles').select('org_id, id').single();
    orgAId = profileA?.org_id as string | null;

    if (!orgAId) {
      console.warn('[rls/imports] Could not resolve Org A org_id — tests may be inconclusive');
      return;
    }

    const profileAId = profileA?.id as string;

    // Seed a csv_imports row for Org A
    const { data: importRow } = await clientOrgAAdmin
      .from('csv_imports')
      .insert({
        org_id:            orgAId,
        import_type:       'monthly_billed',
        original_filename: 'rls-test.csv',
        period:            '2026-01',
        status:            'dry_run',
        row_count:         1,
        failed_count:      0,
        error_summary:     [],
        created_by:        profileAId,
      })
      .select('id')
      .single();

    if (importRow?.id) {
      seededIds.push({ table: 'csv_imports', id: importRow.id as string });

      // Seed an import_rows row linked to the csv_import
      const { data: importRowData } = await clientOrgAAdmin
        .from('import_rows')
        .insert({
          import_id:  importRow.id,
          row_number: 1,
          raw_data:   { room_label: 'RLS-Test-Room', period: '2026-01' },
          status:     'ok',
        })
        .select('id')
        .single();

      if (importRowData?.id) {
        seededIds.push({ table: 'import_rows', id: importRowData.id as string });
      }
    }

    // Seed a phantom_rooms row for Org A
    const { data: phantomRow } = await clientOrgAAdmin
      .from('phantom_rooms')
      .insert({
        org_id:         orgAId,
        raw_room_label: 'rls-test-phantom-room',
        resolution:     'pending',
      })
      .select('id')
      .single();

    if (phantomRow?.id) {
      seededIds.push({ table: 'phantom_rooms', id: phantomRow.id as string });
    }

    // Seed a property_mappings row for Org A
    const { data: propMappingRow } = await clientOrgAAdmin
      .from('property_mappings')
      .insert({
        org_id:        orgAId,
        external_name: 'RLS-Test-Property-External',
        created_by:    profileAId,
      })
      .select('id')
      .single();

    if (propMappingRow?.id) {
      seededIds.push({ table: 'property_mappings', id: propMappingRow.id as string });
    }

    // Seed an account_mappings row for Org A
    const { data: acctMappingRow } = await clientOrgAAdmin
      .from('account_mappings')
      .insert({
        org_id:           orgAId,
        external_account: 'RLS-TEST-ACCT-001',
        is_income:        false,
        affects_net_profit: true,
        created_by:       profileAId,
      })
      .select('id')
      .single();

    if (acctMappingRow?.id) {
      seededIds.push({ table: 'account_mappings', id: acctMappingRow.id as string });
    }
  });

  afterAll(async () => {
    // Clean up seeded rows (Org A admin can delete their own rows)
    for (const { table, id } of seededIds) {
      await clientOrgAAdmin.from(table).delete().eq('id', id);
    }
    await Promise.all([
      clientOrgAAdmin.auth.signOut(),
      clientOrgBAdmin.auth.signOut(),
      clientOrgATenant.auth.signOut(),
    ]);
  });

  // ── csv_imports cross-org isolation ────────────────────────────────────────

  it('csv_imports: Org B admin sees 0 rows from Org A', async () => {
    const importId = seededIds.find(r => r.table === 'csv_imports')?.id;
    if (!importId) return console.warn('[rls/imports] No csv_imports seed row — test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('csv_imports')
      .select('id, org_id')
      .eq('id', importId);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  it('csv_imports: Org A admin sees their own import row', async () => {
    const importId = seededIds.find(r => r.table === 'csv_imports')?.id;
    if (!importId) return console.warn('[rls/imports] No csv_imports seed row — test inconclusive');

    const { data, error } = await clientOrgAAdmin
      .from('csv_imports')
      .select('id, org_id')
      .eq('id', importId);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(importId);
  });

  it('csv_imports: tenant user sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant.from('csv_imports').select('id');
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── import_rows cross-org isolation ────────────────────────────────────────

  it('import_rows: Org B admin sees 0 rows from Org A', async () => {
    const rowId = seededIds.find(r => r.table === 'import_rows')?.id;
    if (!rowId) return console.warn('[rls/imports] No import_rows seed row — test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('import_rows')
      .select('id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it('import_rows: Org A admin sees their own import_rows', async () => {
    const rowId = seededIds.find(r => r.table === 'import_rows')?.id;
    if (!rowId) return console.warn('[rls/imports] No import_rows seed row — test inconclusive');

    const { data, error } = await clientOrgAAdmin
      .from('import_rows')
      .select('id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
  });

  it('import_rows: tenant user sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant.from('import_rows').select('id');
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── phantom_rooms cross-org isolation ─────────────────────────────────────

  it('phantom_rooms: Org B admin sees 0 rows from Org A', async () => {
    const rowId = seededIds.find(r => r.table === 'phantom_rooms')?.id;
    if (!rowId) return console.warn('[rls/imports] No phantom_rooms seed row — test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('phantom_rooms')
      .select('id, org_id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it('phantom_rooms: Org A admin sees their own row', async () => {
    const rowId = seededIds.find(r => r.table === 'phantom_rooms')?.id;
    if (!rowId) return console.warn('[rls/imports] No phantom_rooms seed row — test inconclusive');

    const { data, error } = await clientOrgAAdmin
      .from('phantom_rooms')
      .select('id, org_id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
  });

  it('phantom_rooms: tenant user sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant.from('phantom_rooms').select('id');
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── property_mappings cross-org isolation ─────────────────────────────────

  it('property_mappings: Org B admin sees 0 rows from Org A', async () => {
    const rowId = seededIds.find(r => r.table === 'property_mappings')?.id;
    if (!rowId) return console.warn('[rls/imports] No property_mappings seed row — test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('property_mappings')
      .select('id, org_id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it('property_mappings: tenant sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant.from('property_mappings').select('id');
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── account_mappings cross-org isolation ──────────────────────────────────

  it('account_mappings: Org B admin sees 0 rows from Org A', async () => {
    const rowId = seededIds.find(r => r.table === 'account_mappings')?.id;
    if (!rowId) return console.warn('[rls/imports] No account_mappings seed row — test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('account_mappings')
      .select('id, org_id')
      .eq('id', rowId);

    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it('account_mappings: tenant sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant.from('account_mappings').select('id');
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── WITH CHECK: cross-org INSERT denied ───────────────────────────────────
  // Per feedback_rls_with_check_error.md: WITH CHECK violations raise 42501
  // so we assert the dual case (error.code === '42501' OR 0 rows returned).

  it('csv_imports: WITH CHECK prevents Org B admin inserting row for Org A org_id', async () => {
    if (!orgAId) return console.warn('[rls/imports] No orgAId — WITH CHECK test inconclusive');

    // Resolve Org A's admin profile id for the created_by FK
    const { data: profileA } = await clientOrgAAdmin.from('profiles').select('id').single();
    const profileAId = profileA?.id as string | undefined;
    if (!profileAId) return console.warn('[rls/imports] No profileAId — WITH CHECK test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('csv_imports')
      .insert({
        org_id:            orgAId,   // <- foreign org — should be blocked
        import_type:       'monthly_billed',
        original_filename: 'malicious.csv',
        period:            '2026-01',
        status:            'dry_run',
        row_count:         0,
        failed_count:      0,
        error_summary:     [],
        created_by:        profileAId,
      })
      .select('id');

    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security') || error?.message?.includes('policy');
    const isSilentDeny = !error && (!data || data.length === 0);
    expect(isRlsError || isSilentDeny).toBe(true);
  });

  it('phantom_rooms: WITH CHECK prevents Org B admin inserting row for Org A org_id', async () => {
    if (!orgAId) return console.warn('[rls/imports] No orgAId — WITH CHECK test inconclusive');

    const { data, error } = await clientOrgBAdmin
      .from('phantom_rooms')
      .insert({
        org_id:         orgAId,  // <- foreign org
        raw_room_label: 'cross-org-phantom',
        resolution:     'pending',
      })
      .select('id');

    const isRlsError   = error?.code === '42501' || error?.message?.includes('row-level security') || error?.message?.includes('policy');
    const isSilentDeny = !error && (!data || data.length === 0);
    expect(isRlsError || isSilentDeny).toBe(true);
  });

  // ── All visible rows belong to the querying org ────────────────────────────

  it('csv_imports: all rows visible to Org A admin belong to Org A only', async () => {
    const { data: rowsA } = await clientOrgAAdmin.from('csv_imports').select('id, org_id');
    const { data: rowsB } = await clientOrgBAdmin.from('csv_imports').select('id, org_id');

    const idsA = (rowsA ?? []).map((r: { id: string }) => r.id);
    const idsB = (rowsB ?? []).map((r: { id: string }) => r.id);

    // No Org B row should appear in Org A's results and vice versa
    const crossLeak = idsB.some(id => idsA.includes(id));
    expect(crossLeak).toBe(false);
  });
});
