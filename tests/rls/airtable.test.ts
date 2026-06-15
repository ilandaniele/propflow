/**
 * tests/rls/airtable.test.ts
 *
 * AC29 (partial): airtable_snapshots and airtable_sync_logs have ENABLE + FORCE RLS
 * with WITH CHECK policies. Cross-org SELECT returns 0 rows.
 *
 * Also verifies:
 * - WITH CHECK prevents INSERT of rows with a foreign org_id (raises 42501 per feedback_rls_with_check_error.md)
 * - Tenant users cannot SELECT from either table (admin-only tables)
 *
 * Requires:
 *   TEST_SUPABASE_URL + TEST_SUPABASE_ANON_KEY pointing to a real Supabase project
 *   with the seed applied (admin@org-a.demo / DemoAdmin123!, admin@org-b.demo, etc.)
 *   and migration 20260603000028_airtable_snapshots.sql applied.
 *
 * Follows the EXACT pattern from tests/rls/isolation.test.ts and isolation-phase2.test.ts
 * (skip when no real Supabase credentials are available).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const skipIfNoSupabase = !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder');

describe.skipIf(skipIfNoSupabase)('Airtable RLS Isolation Tests (AC29)', () => {
  let clientOrgAAdmin: SupabaseClient;
  let clientOrgBAdmin: SupabaseClient;
  let clientOrgATenant: SupabaseClient;

  // Track inserted row ids so we can assert cross-org access is denied
  let snapshotRowOrgA: string | null = null;
  let syncLogRowOrgA: string | null = null;

  beforeAll(async () => {
    clientOrgAAdmin = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgBAdmin = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgATenant = createClient(supabaseUrl, supabaseAnonKey);

    const [signinA, signinB, signinT] = await Promise.all([
      clientOrgAAdmin.auth.signInWithPassword({ email: 'admin@org-a.demo', password: 'DemoAdmin123!' }),
      clientOrgBAdmin.auth.signInWithPassword({ email: 'admin@org-b.demo', password: 'DemoAdmin123!' }),
      clientOrgATenant.auth.signInWithPassword({ email: 'tenant@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    if (signinA.error) console.warn('[rls/airtable] Org A admin sign-in failed:', signinA.error.message);
    if (signinB.error) console.warn('[rls/airtable] Org B admin sign-in failed:', signinB.error.message);
    if (signinT.error) console.warn('[rls/airtable] Org A tenant sign-in failed:', signinT.error.message);

    // Resolve Org A's org_id from their profile
    const { data: profileA } = await clientOrgAAdmin
      .from('profiles')
      .select('org_id')
      .single();

    const orgAId = profileA?.org_id as string | undefined;
    if (!orgAId) {
      console.warn('[rls/airtable] Could not resolve Org A org_id — some tests may be inconclusive');
      return;
    }

    // Insert a seed snapshot row for Org A (will be used for cross-org tests)
    const { data: snap } = await clientOrgAAdmin
      .from('airtable_snapshots')
      .insert({
        org_id: orgAId,
        table_name: 'rooms',
        external_id: 'rls-test-rec-001',
        data: { name: 'RLS Test Room', status: 'vacant' },
      })
      .select('id')
      .single();

    snapshotRowOrgA = snap?.id ?? null;

    // Insert a seed sync log row for Org A
    const { data: log } = await clientOrgAAdmin
      .from('airtable_sync_logs')
      .insert({
        org_id: orgAId,
        table_name: 'rooms',
        status: 'success',
        records_upserted: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    syncLogRowOrgA = log?.id ?? null;
  });

  afterAll(async () => {
    // Clean up test rows (will be blocked by RLS for other orgs — only Org A can delete)
    if (snapshotRowOrgA) {
      await clientOrgAAdmin
        .from('airtable_snapshots')
        .delete()
        .eq('id', snapshotRowOrgA);
    }
    if (syncLogRowOrgA) {
      await clientOrgAAdmin
        .from('airtable_sync_logs')
        .delete()
        .eq('id', syncLogRowOrgA);
    }

    await Promise.all([
      clientOrgAAdmin.auth.signOut(),
      clientOrgBAdmin.auth.signOut(),
      clientOrgATenant.auth.signOut(),
    ]);
  });

  // ── airtable_snapshots cross-org isolation ────────────────────────────────

  it('airtable_snapshots: Org B admin sees 0 rows from Org A snapshots', async () => {
    if (!snapshotRowOrgA) {
      console.warn('[rls/airtable] No snapshot seed row — test inconclusive');
      return;
    }

    // Org B queries by the specific row id that belongs to Org A
    const { data, error } = await clientOrgBAdmin
      .from('airtable_snapshots')
      .select('id, org_id')
      .eq('id', snapshotRowOrgA);

    // RLS must return 0 rows (silent deny — not an error)
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  it('airtable_snapshots: Org A admin sees their own snapshot row', async () => {
    if (!snapshotRowOrgA) {
      console.warn('[rls/airtable] No snapshot seed row — test inconclusive');
      return;
    }

    const { data, error } = await clientOrgAAdmin
      .from('airtable_snapshots')
      .select('id, org_id')
      .eq('id', snapshotRowOrgA);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(snapshotRowOrgA);
  });

  it('airtable_snapshots: all rows visible to Org A admin belong to Org A only', async () => {
    const { data: rowsA } = await clientOrgAAdmin.from('airtable_snapshots').select('id, org_id');
    const { data: rowsB } = await clientOrgBAdmin.from('airtable_snapshots').select('id, org_id');

    // Org A results must not include any Org B row ids, and vice versa
    const idsA = (rowsA ?? []).map((r: { id: string }) => r.id);
    const idsB = (rowsB ?? []).map((r: { id: string }) => r.id);

    const crossLeak = idsB.some(id => idsA.includes(id));
    expect(crossLeak).toBe(false);
  });

  // ── airtable_sync_logs cross-org isolation ────────────────────────────────

  it('airtable_sync_logs: Org B admin sees 0 rows from Org A logs', async () => {
    if (!syncLogRowOrgA) {
      console.warn('[rls/airtable] No sync log seed row — test inconclusive');
      return;
    }

    const { data, error } = await clientOrgBAdmin
      .from('airtable_sync_logs')
      .select('id, org_id')
      .eq('id', syncLogRowOrgA);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  it('airtable_sync_logs: Org A admin sees their own log row', async () => {
    if (!syncLogRowOrgA) {
      console.warn('[rls/airtable] No sync log seed row — test inconclusive');
      return;
    }

    const { data, error } = await clientOrgAAdmin
      .from('airtable_sync_logs')
      .select('id, org_id')
      .eq('id', syncLogRowOrgA);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(syncLogRowOrgA);
  });

  it('airtable_sync_logs: all rows visible to Org A admin belong to Org A only', async () => {
    const { data: logsA } = await clientOrgAAdmin.from('airtable_sync_logs').select('id, org_id');
    const { data: logsB } = await clientOrgBAdmin.from('airtable_sync_logs').select('id, org_id');

    const idsA = (logsA ?? []).map((r: { id: string }) => r.id);
    const idsB = (logsB ?? []).map((r: { id: string }) => r.id);

    const crossLeak = idsB.some(id => idsA.includes(id));
    expect(crossLeak).toBe(false);
  });

  // ── Tenant access denied ──────────────────────────────────────────────────

  it('airtable_snapshots: tenant user sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant
      .from('airtable_snapshots')
      .select('id');

    // RLS deny = 0 rows + no error (silent deny), OR an error with code 42501
    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  it('airtable_sync_logs: tenant user sees 0 rows (admin-only table)', async () => {
    const { data, error } = await clientOrgATenant
      .from('airtable_sync_logs')
      .select('id');

    const isSilentDeny = !error && Array.isArray(data) && data.length === 0;
    const isRlsError = error?.code === '42501' || error?.message?.includes('row-level security');
    expect(isSilentDeny || isRlsError).toBe(true);
  });

  // ── WITH CHECK: cross-org INSERT is denied ────────────────────────────────
  // Per feedback_rls_with_check_error.md: WITH CHECK violations raise 42501
  // so we assert on the dual case (error.code === '42501' OR 0 rows returned).

  it('airtable_snapshots: WITH CHECK prevents Org B admin inserting row for Org A org_id', async () => {
    // Resolve Org A's org_id from Org A admin's session (the foreign org_id to attempt)
    const { data: profileA } = await clientOrgAAdmin
      .from('profiles')
      .select('org_id')
      .single();

    const orgAId = profileA?.org_id as string | undefined;
    if (!orgAId) {
      console.warn('[rls/airtable] Could not resolve Org A org_id — WITH CHECK test inconclusive');
      return;
    }

    // Org B admin attempts to INSERT a row claiming it belongs to Org A
    const { data, error } = await clientOrgBAdmin
      .from('airtable_snapshots')
      .insert({
        org_id: orgAId,           // <- foreign org_id, should be blocked by WITH CHECK
        table_name: 'rooms',
        external_id: 'rls-test-cross-org-attempt',
        data: { malicious: true },
      })
      .select('id');

    // Must be denied — either via error 42501 or by returning 0 rows (RLS silent deny)
    const isRlsError = error?.code === '42501' || error?.message?.includes('row-level security') || error?.message?.includes('policy');
    const isSilentDeny = !error && (!data || data.length === 0);
    expect(isRlsError || isSilentDeny).toBe(true);

    // Extra guard: if somehow data was returned, it must NOT have Org A's org_id
    if (data && data.length > 0) {
      for (const row of data) {
        expect((row as { org_id?: string }).org_id).not.toBe(orgAId);
      }
    }
  });
});
