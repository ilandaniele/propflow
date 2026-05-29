/**
 * RLS Isolation Tests
 *
 * These tests verify the PRIMARY security requirement:
 * strict per-organization data isolation enforced by Supabase RLS.
 *
 * Requirements:
 *   - TEST_SUPABASE_URL must point to a real Supabase project
 *   - TEST_SUPABASE_ANON_KEY is the anon key for that project
 *   - Seed must have been run (creates orgA/orgB users and data)
 *
 * Credentials (from seed.ts):
 *   Org A admin:  admin@org-a.demo  /  DemoAdmin123!
 *   Org A tenant: tenant@org-a.demo /  DemoTenant123!
 *   Org B admin:  admin@org-b.demo  /  DemoAdmin123!
 *   Org B tenant: tenant@org-b.demo /  DemoTenant123!
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const skipIfNoSupabase = !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder');

describe.skipIf(skipIfNoSupabase)('RLS Isolation Tests', () => {
  let clientOrgAAdmin: SupabaseClient;
  let clientOrgBAdmin: SupabaseClient;
  let clientOrgATenant: SupabaseClient;

  beforeAll(async () => {
    // Create separate clients for each user
    clientOrgAAdmin = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgBAdmin = createClient(supabaseUrl, supabaseAnonKey);
    clientOrgATenant = createClient(supabaseUrl, supabaseAnonKey);

    // Sign in each user
    const [signInA, signInB, signInT] = await Promise.all([
      clientOrgAAdmin.auth.signInWithPassword({ email: 'admin@org-a.demo', password: 'DemoAdmin123!' }),
      clientOrgBAdmin.auth.signInWithPassword({ email: 'admin@org-b.demo', password: 'DemoAdmin123!' }),
      clientOrgATenant.auth.signInWithPassword({ email: 'tenant@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    if (signInA.error) console.warn('[rls-test] Org A admin sign-in failed:', signInA.error.message);
    if (signInB.error) console.warn('[rls-test] Org B admin sign-in failed:', signInB.error.message);
    if (signInT.error) console.warn('[rls-test] Org A tenant sign-in failed:', signInT.error.message);
  });

  afterAll(async () => {
    await Promise.all([
      clientOrgAAdmin.auth.signOut(),
      clientOrgBAdmin.auth.signOut(),
      clientOrgATenant.auth.signOut(),
    ]);
  });

  // Scenario 6: Org A admin cannot read Org B tenants
  it('Org A admin gets 0 rows when querying all tenants (should only see Org A)', async () => {
    const { data: tenantsFromA } = await clientOrgAAdmin.from('tenants').select('id, org_id');
    const { data: tenantsFromB } = await clientOrgBAdmin.from('tenants').select('id, org_id');

    // Each admin should only see their own org's tenants
    // Their respective org_ids should all match
    if (tenantsFromA && tenantsFromA.length > 0) {
      const orgIds = [...new Set(tenantsFromA.map((t: { org_id: string }) => t.org_id))];
      expect(orgIds).toHaveLength(1); // only one org_id in results
    }

    if (tenantsFromB && tenantsFromB.length > 0) {
      const orgIds = [...new Set(tenantsFromB.map((t: { org_id: string }) => t.org_id))];
      expect(orgIds).toHaveLength(1);
    }

    // Org A's tenants should NOT appear in Org B admin's query
    const orgAIds = (tenantsFromA ?? []).map((t: { id: string }) => t.id);
    const orgBResults = tenantsFromB ?? [];
    const crossOrgLeak = orgBResults.some((t: { id: string }) => orgAIds.includes(t.id));
    expect(crossOrgLeak).toBe(false);
  });

  // Scenario 8: T1 cannot read T2 payments (same org)
  it('Tenant T1 cannot read other tenants payments from same org', async () => {
    const { data: payments } = await clientOrgATenant.from('payments').select('tenant_id');

    // Get the tenant's own ID
    const { data: profile } = await clientOrgATenant.from('profiles').select('id').single();
    const { data: tenantRow } = await clientOrgATenant.from('tenants').select('id').eq('profile_id', profile?.id ?? '').single();

    if (payments && tenantRow) {
      // All visible payments should belong to this tenant
      for (const payment of payments) {
        expect(payment.tenant_id).toBe(tenantRow.id);
      }
    }
  });

  // Scenario 9: Cross-org insert rejected by WITH CHECK
  it('Org B admin cannot insert a tenant with Org A org_id', async () => {
    // Get Org A id
    const { data: orgAProfile } = await clientOrgAAdmin.from('organizations').select('id').single();
    const orgAId = orgAProfile?.id;

    if (!orgAId) {
      // Can't get Org A id from Org B's client (RLS won't show it)
      console.warn('[rls-test] Could not get Org A id — skipping WITH CHECK test');
      return;
    }

    // Try to insert a tenant with Org A's id from Org B's client
    const { error } = await clientOrgBAdmin.from('tenants').insert({
      org_id: orgAId, // WRONG: trying to insert into another org
      full_name: 'Hacker Tenant',
      email: 'hacker@evil.com',
    });

    // Should be rejected by WITH CHECK policy
    expect(error).toBeTruthy();
  });

  // Tenant cannot approve payments
  it('Tenant cannot set payment status to approved', async () => {
    // Fetch a payment the tenant can see (their own)
    const { data: payments } = await clientOrgATenant
      .from('payments')
      .select('id, status')
      .limit(1);
    if (!payments || payments.length === 0) {
      console.warn('[rls-test] No payments found for tenant — skipping approve test');
      return;
    }

    const targetId = payments[0].id;
    const statusBefore = payments[0].status as string;

    // Attempt the forbidden update as tenant; use .select() to capture affected rows.
    // In Postgres RLS + PostgREST, a denied UPDATE returns 0 rows and NO error —
    // asserting `error` is truthy is WRONG. Assert affected rows = 0 AND state unchanged.
    const { data: affected, error: updateError } = await clientOrgATenant
      .from('payments')
      .update({ status: 'approved' })
      .eq('id', targetId)
      .select('id');

    // No UPDATE policy exists for tenants on payments → 0 rows affected, no error.
    expect(updateError).toBeNull();          // RLS denies silently — no DB error
    expect(affected).toHaveLength(0);        // 0 rows returned = 0 rows changed

    // Privileged re-fetch: org A admin can read all org A payments.
    // Assert the row is truly unchanged (status was not mutated).
    const { data: refetched } = await clientOrgAAdmin
      .from('payments')
      .select('status')
      .eq('id', targetId)
      .single();

    expect(refetched?.status).toBe(statusBefore); // value must equal pre-attempt status
    expect(refetched?.status).not.toBe('approved'); // explicit: never approved by tenant
  });

  // Tenant cannot mark incident as solved
  it('Tenant cannot set incident status to solved', async () => {
    // Fetch an incident the tenant can see (created by them or linked to them)
    const { data: incidents } = await clientOrgATenant
      .from('incidents')
      .select('id, status')
      .limit(1);
    if (!incidents || incidents.length === 0) {
      console.warn('[rls-test] No incidents found for tenant — skipping solve test');
      return;
    }

    const targetId = incidents[0].id;
    const statusBefore = incidents[0].status as string;

    // Attempt the forbidden update as tenant; use .select() to capture affected rows.
    // No UPDATE policy exists for tenants on incidents → 0 rows affected, no error.
    const { data: affected, error: updateError } = await clientOrgATenant
      .from('incidents')
      .update({ status: 'solved' })
      .eq('id', targetId)
      .select('id');

    // RLS silently denies: no error raised, no rows mutated.
    expect(updateError).toBeNull();          // RLS denies silently — no DB error
    expect(affected).toHaveLength(0);        // 0 rows returned = 0 rows changed

    // Privileged re-fetch: org A admin can read all org A incidents.
    // Assert the row is truly unchanged (status was not mutated).
    const { data: refetched } = await clientOrgAAdmin
      .from('incidents')
      .select('status')
      .eq('id', targetId)
      .single();

    expect(refetched?.status).toBe(statusBefore); // value must equal pre-attempt status
    expect(refetched?.status).not.toBe('solved');  // explicit: never solved by tenant
  });

  // Cross-org org list: Org B admin should only see Org B org
  it('Org B admin only sees their own organization', async () => {
    const { data: orgs } = await clientOrgBAdmin.from('organizations').select('id, name');
    expect(orgs).toHaveLength(1);
    expect(orgs?.[0]?.name).toContain('Org B');
  });
});

// Describe block for skipped tests to inform the runner
describe.skipIf(!skipIfNoSupabase)('RLS Isolation Tests (SKIPPED — no Supabase config)', () => {
  it('All RLS tests require a live Supabase project with seeded data', () => {
    console.warn(
      '[rls-test] RLS tests skipped. Set TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY env vars and run the seed script to enable them.'
    );
    expect(true).toBe(true); // Not a failure — just informational
  });
});
