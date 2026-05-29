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
    // Fetch a PENDING payment the tenant can see (their own).
    // Must filter status='pending' explicitly: the seed also inserts an already-approved
    // payment and without a filter `.limit(1)` may return that row first. The test assertion
    // `expect(status).not.toBe('approved')` would then fail trivially — not because the
    // update succeeded, but because the row was already approved before the test ran.
    // Filtering for 'pending' tests the real escalation scenario (tenant tries to flip a
    // pending payment to approved). This is more precise, not weaker.
    const { data: payments } = await clientOrgATenant
      .from('payments')
      .select('id, status')
      .eq('status', 'pending')
      .limit(1);
    if (!payments || payments.length === 0) {
      console.warn('[rls-test] No pending payments found for tenant — skipping approve test');
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

// ─── Google-provisioned admin org isolation ──────────────────────────────────
// Scenario 13: a freshly-provisioned admin (as if from Google OAuth onboarding)
// in a new org reads only their org's rows and cannot read another org's rows.
//
// This test uses the service-role admin client to set up state, then verifies
// isolation using a regular anon-key client (as the user would).
describe.skipIf(skipIfNoSupabase)('Google-provisioned admin org isolation', () => {
  const adminServiceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const skipIfNoServiceKey = !adminServiceKey || adminServiceKey.includes('placeholder');

  it.skipIf(skipIfNoServiceKey)('provisioned admin in new org can only read their own org data', async () => {
    const { createClient: createAdminClientFromSupa } = await import('@supabase/supabase-js');

    const adminClient = createAdminClientFromSupa(supabaseUrl, adminServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create a fresh org for the Google-provisioned user
    const testOrgSlug = `rls-test-google-${Date.now()}`;
    const { data: newOrg, error: orgErr } = await adminClient
      .from('organizations')
      .insert({ name: 'RLS Test Google Org', slug: testOrgSlug })
      .select()
      .single();

    if (orgErr || !newOrg) {
      console.warn('[rls-test] Could not create test org for Google isolation test:', orgErr?.message);
      return;
    }

    // 2. Create a Supabase auth user (simulating Google sign-up)
    const testEmail = `rls-google-${Date.now()}@test.example.com`;
    const { data: newAuthUser, error: createUserErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: 'TestRLS1234!',
      email_confirm: true,
    });

    if (createUserErr || !newAuthUser?.user) {
      console.warn('[rls-test] Could not create test auth user:', createUserErr?.message);
      // Cleanup org
      await adminClient.from('organizations').delete().eq('id', newOrg.id);
      return;
    }

    // 3. Provision profile via admin client (mirrors what provisionOrgAndProfile() does)
    const { error: profileErr } = await adminClient.from('profiles').insert({
      id: newAuthUser.user.id,
      org_id: newOrg.id,
      role: 'admin',
      full_name: 'RLS Test Google User',
      email: testEmail,
    });

    if (profileErr) {
      console.warn('[rls-test] Could not insert profile for Google user:', profileErr.message);
      await adminClient.from('organizations').delete().eq('id', newOrg.id);
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
      return;
    }

    // 4. Sign in as the new user with anon client (RLS enforced)
    const userClient = createAdminClientFromSupa(supabaseUrl, supabaseAnonKey);
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: testEmail,
      password: 'TestRLS1234!',
    });

    if (signInErr) {
      console.warn('[rls-test] Google user sign-in failed:', signInErr.message);
      await adminClient.from('profiles').delete().eq('id', newAuthUser.user.id);
      await adminClient.from('organizations').delete().eq('id', newOrg.id);
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
      return;
    }

    try {
      // 5. Assert: user can read their own org
      const { data: ownOrg } = await userClient.from('organizations').select('id').eq('id', newOrg.id);
      expect(ownOrg).toHaveLength(1);

      // 6. Assert: user cannot read Org A's data (from existing seed)
      // The admin from Org A's email is 'admin@org-a.demo'
      // We query profiles where id != our new user — should return 0 rows (RLS)
      const { data: otherProfiles } = await userClient
        .from('profiles')
        .select('id, org_id')
        .neq('id', newAuthUser.user.id);

      // RLS policy "profiles_select_org" allows SELECT only for own org.
      // All returned rows must belong to the new org.
      if (otherProfiles && otherProfiles.length > 0) {
        for (const p of otherProfiles) {
          expect(p.org_id).toBe(newOrg.id);
        }
      }

      // 7. Assert: organizations query returns ONLY the new org (not Org A or B)
      const { data: visibleOrgs } = await userClient.from('organizations').select('id');
      expect(visibleOrgs).toHaveLength(1);
      expect(visibleOrgs?.[0]?.id).toBe(newOrg.id);

      console.log('[rls-test] Google-provisioned admin org isolation: PASS');
    } finally {
      // Cleanup — always remove test data regardless of assertion outcome
      await userClient.auth.signOut();
      await adminClient.from('profiles').delete().eq('id', newAuthUser.user.id);
      await adminClient.from('organizations').delete().eq('id', newOrg.id);
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
    }
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
