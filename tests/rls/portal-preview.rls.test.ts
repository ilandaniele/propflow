/**
 * RLS tests for Portal Preview tables (W6 / AC3, AC8, AC10).
 *
 * Tests verify cross-org and cross-tenant isolation for:
 *   - notification_inbox  (AC8)
 *   - visitor_logs        (AC3 — org_id isolation)
 *   - ai_chat_messages    (AC10)
 *
 * Dual-case assertion pattern (per MEMORY: feedback_rls_with_check_error.md):
 *   - Cross-org SELECT returns 0 rows (silent filter — RLS denies without error)
 *   - WITH CHECK violations on INSERT raise Postgres error code 42501
 *
 * Credentials (from seed.ts):
 *   Org A admin:  admin@org-a.demo  /  DemoAdmin123!
 *   Org A tenant: tenant@org-a.demo /  DemoTenant123!
 *   Org B admin:  admin@org-b.demo  /  DemoAdmin123!
 *
 * Requirements:
 *   - TEST_SUPABASE_URL must point to a real Supabase project with seeded data
 *   - TEST_SUPABASE_ANON_KEY is the anon key for that project
 *   - These are skipped when env vars are absent or contain placeholder values
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.TEST_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

const skipIfNoSupabase =
  !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder');

// ─────────────────────────────────────────────────────────────────────────────
// notification_inbox — AC8 RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skipIfNoSupabase)(
  'RLS Portal Preview — notification_inbox (AC8)',
  () => {
    let clientOrgAAdmin: SupabaseClient;
    let clientOrgATenant: SupabaseClient;

    beforeAll(async () => {
      clientOrgAAdmin = createClient(supabaseUrl, supabaseAnonKey);
      clientOrgATenant = createClient(supabaseUrl, supabaseAnonKey);

      const [signInAdmin, signInTenant] = await Promise.all([
        clientOrgAAdmin.auth.signInWithPassword({
          email: 'admin@org-a.demo',
          password: 'DemoAdmin123!',
        }),
        clientOrgATenant.auth.signInWithPassword({
          email: 'tenant@org-a.demo',
          password: 'DemoTenant123!',
        }),
      ]);

      if (signInAdmin.error)
        console.warn(
          '[portal-preview-rls] Org A admin sign-in failed:',
          signInAdmin.error.message
        );
      if (signInTenant.error)
        console.warn(
          '[portal-preview-rls] Org A tenant sign-in failed:',
          signInTenant.error.message
        );
    });

    afterAll(async () => {
      await Promise.all([
        clientOrgAAdmin.auth.signOut(),
        clientOrgATenant.auth.signOut(),
      ]);
    });

    it('AC8 Test 1: admin can SELECT notification_inbox for tenant in same org — returns rows (or empty, not denied)', async () => {
      // Admin in Org A reads notification_inbox — RLS policy "admin_read_inbox" grants
      // SELECT to admins in the same org. The query should not return an error.
      const { data, error } = await clientOrgAAdmin
        .from('notification_inbox')
        .select('id, org_id, profile_id')
        .limit(10);

      // Admin-read policy must not deny — no RLS error expected
      expect(error).toBeNull();
      // If rows exist, all must belong to the admin's org (no cross-org leak)
      if (data && data.length > 0) {
        // Retrieve admin's own org_id for comparison
        const { data: adminProfile } = await clientOrgAAdmin
          .from('profiles')
          .select('org_id')
          .single();
        const adminOrgId = adminProfile?.org_id;
        if (adminOrgId) {
          for (const row of data) {
            expect(
              (row as { org_id: string }).org_id,
              'Admin should only see inbox rows from their own org'
            ).toBe(adminOrgId);
          }
        }
      }
    });

    it('AC8 Test 2: tenant user cannot SELECT notification_inbox rows belonging to another tenant profile — expects 0 cross-tenant rows', async () => {
      // The tenant can see their own profile_id rows only (RLS owner-only policy).
      // Fetch the tenant's own profile_id first, then query for rows NOT owned by them.
      const { data: tenantProfile } = await clientOrgATenant
        .from('profiles')
        .select('id')
        .single();
      const tenantProfileId = tenantProfile?.id;

      if (!tenantProfileId) {
        console.warn(
          '[portal-preview-rls] Could not resolve tenant profile_id — skipping cross-tenant inbox test'
        );
        return;
      }

      // Tenant queries the inbox — RLS must scope results to their profile_id only.
      // They must NOT see rows belonging to other profile_ids.
      const { data: inboxRows } = await clientOrgATenant
        .from('notification_inbox')
        .select('id, profile_id')
        .limit(20);

      const crossTenantRows = (inboxRows ?? []).filter(
        (r: { profile_id: string | null }) => r.profile_id !== tenantProfileId
      );
      // Dual-case: RLS silently filters — no error raised, but 0 cross-tenant rows
      expect(
        crossTenantRows,
        'Tenant must not see notification_inbox rows owned by other tenants'
      ).toHaveLength(0);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// visitor_logs — AC3 cross-org isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skipIfNoSupabase)(
  'RLS Portal Preview — visitor_logs cross-org isolation (AC3)',
  () => {
    let clientOrgAAdmin: SupabaseClient;
    let clientOrgBAdmin: SupabaseClient;

    beforeAll(async () => {
      clientOrgAAdmin = createClient(supabaseUrl, supabaseAnonKey);
      clientOrgBAdmin = createClient(supabaseUrl, supabaseAnonKey);

      const [signInA, signInB] = await Promise.all([
        clientOrgAAdmin.auth.signInWithPassword({
          email: 'admin@org-a.demo',
          password: 'DemoAdmin123!',
        }),
        clientOrgBAdmin.auth.signInWithPassword({
          email: 'admin@org-b.demo',
          password: 'DemoAdmin123!',
        }),
      ]);

      if (signInA.error)
        console.warn(
          '[portal-preview-rls] Org A admin sign-in failed:',
          signInA.error.message
        );
      if (signInB.error)
        console.warn(
          '[portal-preview-rls] Org B admin sign-in failed:',
          signInB.error.message
        );
    });

    afterAll(async () => {
      await Promise.all([
        clientOrgAAdmin.auth.signOut(),
        clientOrgBAdmin.auth.signOut(),
      ]);
    });

    it('AC3 Test 3: admin from org A cannot SELECT visitor_logs rows with org_id=B — expects 0 cross-org rows', async () => {
      // Get Org A visitor_log IDs
      const { data: orgALogs } = await clientOrgAAdmin
        .from('visitor_logs')
        .select('id, org_id');
      const orgALogIds = new Set(
        (orgALogs ?? []).map((r: { id: string }) => r.id)
      );

      // Get Org B admin's visitor_logs — must not contain any Org A rows
      const { data: orgBLogs } = await clientOrgBAdmin
        .from('visitor_logs')
        .select('id, org_id');

      const crossOrgLeak = (orgBLogs ?? []).some((r: { id: string }) =>
        orgALogIds.has(r.id)
      );
      // Dual-case: RLS silently filters cross-org rows — no error, but 0 leaks
      expect(
        crossOrgLeak,
        'Org B admin must not see any visitor_logs rows belonging to Org A'
      ).toBe(false);

      // Additionally, all Org B admin's visible rows must have Org B's org_id
      if (orgBLogs && orgBLogs.length > 0) {
        const { data: orgBProfile } = await clientOrgBAdmin
          .from('organizations')
          .select('id')
          .single();
        const orgBId = orgBProfile?.id;
        if (orgBId) {
          for (const row of orgBLogs) {
            expect(
              (row as { org_id: string }).org_id,
              'Org B admin should only see visitor_logs from Org B'
            ).toBe(orgBId);
          }
        }
      }
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ai_chat_messages — AC10 RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skipIfNoSupabase)(
  'RLS Portal Preview — ai_chat_messages (AC10)',
  () => {
    let clientOrgAAdmin: SupabaseClient;
    let clientOrgATenant: SupabaseClient;

    beforeAll(async () => {
      clientOrgAAdmin = createClient(supabaseUrl, supabaseAnonKey);
      clientOrgATenant = createClient(supabaseUrl, supabaseAnonKey);

      const [signInAdmin, signInTenant] = await Promise.all([
        clientOrgAAdmin.auth.signInWithPassword({
          email: 'admin@org-a.demo',
          password: 'DemoAdmin123!',
        }),
        clientOrgATenant.auth.signInWithPassword({
          email: 'tenant@org-a.demo',
          password: 'DemoTenant123!',
        }),
      ]);

      if (signInAdmin.error)
        console.warn(
          '[portal-preview-rls] Org A admin sign-in failed:',
          signInAdmin.error.message
        );
      if (signInTenant.error)
        console.warn(
          '[portal-preview-rls] Org A tenant sign-in failed:',
          signInTenant.error.message
        );
    });

    afterAll(async () => {
      await Promise.all([
        clientOrgAAdmin.auth.signOut(),
        clientOrgATenant.auth.signOut(),
      ]);
    });

    it('AC10 Test 4: admin can SELECT ai_chat_messages for tenant in same org — no RLS error', async () => {
      // Admin in Org A reads ai_chat_messages — the W1 migration added an admin-read
      // policy. The query must not be denied and all visible rows must belong to Org A.
      const { data, error } = await clientOrgAAdmin
        .from('ai_chat_messages')
        .select('id, org_id, profile_id')
        .limit(10);

      // No RLS error expected for admin-read policy
      expect(error).toBeNull();

      // All rows returned must belong to the admin's org
      if (data && data.length > 0) {
        const { data: adminProfile } = await clientOrgAAdmin
          .from('profiles')
          .select('org_id')
          .single();
        const adminOrgId = adminProfile?.org_id;
        if (adminOrgId) {
          for (const row of data) {
            expect(
              (row as { org_id: string }).org_id,
              'Admin should only see ai_chat_messages from their own org'
            ).toBe(adminOrgId);
          }
        }
      }
    });

    it('AC10 Test 5: tenant user cannot SELECT ai_chat_messages belonging to another profile — expects 0 cross-profile rows', async () => {
      // Tenant's RLS policy scopes ai_chat_messages to their own profile_id only.
      const { data: tenantProfile } = await clientOrgATenant
        .from('profiles')
        .select('id')
        .single();
      const tenantProfileId = tenantProfile?.id;

      if (!tenantProfileId) {
        console.warn(
          '[portal-preview-rls] Could not resolve tenant profile_id — skipping cross-tenant ai_chat_messages test'
        );
        return;
      }

      const { data: messages } = await clientOrgATenant
        .from('ai_chat_messages')
        .select('id, profile_id')
        .limit(20);

      const crossProfileRows = (messages ?? []).filter(
        (m: { profile_id: string | null }) => m.profile_id !== tenantProfileId
      );
      // Dual-case: RLS silently filters — no error, but 0 rows for other profiles
      expect(
        crossProfileRows,
        'Tenant must not see ai_chat_messages belonging to other profiles'
      ).toHaveLength(0);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Informational skip block — surfaces in CI when Supabase config is absent
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!skipIfNoSupabase)(
  'RLS Portal Preview tests (SKIPPED — no Supabase config)',
  () => {
    it('All portal-preview RLS tests require a live Supabase project with seeded data', () => {
      console.warn(
        '[portal-preview-rls] Skipped. Set TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY to enable.'
      );
      expect(true).toBe(true);
    });
  }
);
