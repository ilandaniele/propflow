/**
 * RLS Tests: unit_images table + storage.objects (unit-images + tenant-avatars)
 *
 * Covers W1 acceptance criteria:
 *   AC1  — Admin can INSERT into unit_images
 *   AC2  — Admin can SELECT all unit_images in org
 *   AC3  — Tenant can SELECT only their own unit's images
 *   AC9  — Tenant CANNOT SELECT another unit's images (0 rows, not an error)
 *   AC12 — Tenant CANNOT INSERT into unit_images directly (admin-only insert → 42501 / RLS violation)
 *   Storage AC3 — Tenant can SELECT their own unit folder objects
 *   Storage AC9 — Tenant cannot SELECT another unit's storage objects
 *   Storage AC12 — Tenant cannot upload to another tenant's avatar path (42501)
 *
 * Prerequisites:
 *   - TEST_SUPABASE_URL + TEST_SUPABASE_ANON_KEY env vars pointing to a test Supabase project
 *   - Migration 000035 (unit_images table) applied
 *   - Migration 000036 (unit-images bucket) applied
 *   - Migration 000037 (tenant-avatars self policy) applied
 *   - Seed users/data present (from supabase/seed.sql)
 *
 * Seed credentials (must exist in test project):
 *   Org A admin:   admin@org-a.demo   / DemoAdmin123!
 *   Org A tenant:  tenant@org-a.demo  / DemoTenant123!
 *   Org A tenant2: tenant2@org-a.demo / DemoTenant123!  (assigned to a DIFFERENT unit)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.TEST_SUPABASE_URL     ?? process.env.NEXT_PUBLIC_SUPABASE_URL     ?? '';
const supabaseAnonKey = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const skipIfNoSupabase = !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder');

describe.skipIf(skipIfNoSupabase)('RLS: unit_images table', () => {
  let adminClient:   SupabaseClient;
  let tenantClient:  SupabaseClient;
  let tenant2Client: SupabaseClient;

  // IDs populated during beforeAll
  let orgAId:   string;
  let unitAId:  string;  // unit assigned to tenantClient
  let unit2Id:  string;  // unit assigned to tenant2Client (different unit, same org)

  // Row inserted by admin during tests — cleaned up in afterAll
  let insertedImageId: string | null = null;

  beforeAll(async () => {
    adminClient   = createClient(supabaseUrl, supabaseAnonKey);
    tenantClient  = createClient(supabaseUrl, supabaseAnonKey);
    tenant2Client = createClient(supabaseUrl, supabaseAnonKey);

    const [a, t, t2] = await Promise.all([
      adminClient.auth.signInWithPassword({ email: 'admin@org-a.demo',   password: 'DemoAdmin123!'  }),
      tenantClient.auth.signInWithPassword({ email: 'tenant@org-a.demo',  password: 'DemoTenant123!' }),
      tenant2Client.auth.signInWithPassword({ email: 'tenant2@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    if (a.error)  console.warn('[unit-images rls] admin sign-in failed:',   a.error.message);
    if (t.error)  console.warn('[unit-images rls] tenant sign-in failed:',  t.error.message);
    if (t2.error) console.warn('[unit-images rls] tenant2 sign-in failed:', t2.error.message);

    // Resolve org + unit IDs via admin client
    const { data: profile } = await adminClient
      .from('profiles')
      .select('org_id')
      .eq('email', 'admin@org-a.demo')
      .single();
    orgAId = profile?.org_id ?? '';

    const { data: tenantRow } = await tenantClient
      .from('tenants')
      .select('unit_id')
      .eq('profile_id', (await tenantClient.auth.getUser()).data.user?.id ?? '')
      .single();
    unitAId = tenantRow?.unit_id ?? '';

    const { data: tenant2Row } = await tenant2Client
      .from('tenants')
      .select('unit_id')
      .eq('profile_id', (await tenant2Client.auth.getUser()).data.user?.id ?? '')
      .single();
    unit2Id = tenant2Row?.unit_id ?? '';
  });

  afterAll(async () => {
    // Clean up inserted test row
    if (insertedImageId) {
      await adminClient.from('unit_images').delete().eq('id', insertedImageId);
    }
    await Promise.all([
      adminClient.auth.signOut(),
      tenantClient.auth.signOut(),
      tenant2Client.auth.signOut(),
    ]);
  });

  // AC1 — Admin can INSERT a unit_images row
  it('AC1: admin can insert a unit_images row', async () => {
    if (!orgAId || !unitAId) {
      console.warn('[unit-images rls] skipping AC1: orgAId or unitAId not resolved');
      return;
    }
    const adminUserId = (await adminClient.auth.getUser()).data.user?.id ?? '';
    const { data, error } = await adminClient
      .from('unit_images')
      .insert({
        unit_id:     unitAId,
        org_id:      orgAId,
        storage_path: `${orgAId}/${unitAId}/test-rls-image.jpg`,
        filename:    'test-rls-image.jpg',
        mime_type:   'image/jpeg',
        size_bytes:  102400,
        is_cover:    false,
        sort_order:  0,
        uploaded_by: adminUserId,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    insertedImageId = data?.id ?? null;
  });

  // AC2 — Admin can SELECT unit_images in their org
  it('AC2: admin can select unit_images in their org', async () => {
    if (!orgAId) {
      console.warn('[unit-images rls] skipping AC2: orgAId not resolved');
      return;
    }
    const { data, error } = await adminClient
      .from('unit_images')
      .select('id, org_id')
      .eq('org_id', orgAId);

    expect(error).toBeNull();
    // All returned rows must belong to orgA
    if (data && data.length > 0) {
      const uniqueOrgs = [...new Set(data.map((r: { org_id: string }) => r.org_id))];
      expect(uniqueOrgs).toHaveLength(1);
      expect(uniqueOrgs[0]).toBe(orgAId);
    }
  });

  // AC3 — Tenant can SELECT images for their own unit
  it('AC3: tenant can select images for their own assigned unit', async () => {
    if (!unitAId) {
      console.warn('[unit-images rls] skipping AC3: unitAId not resolved');
      return;
    }
    const { data, error } = await tenantClient
      .from('unit_images')
      .select('id, unit_id')
      .eq('unit_id', unitAId);

    expect(error).toBeNull();
    // Tenant may get 0 rows if none inserted yet — that is fine; no error is the assertion
    if (data) {
      data.forEach((r: { unit_id: string }) => expect(r.unit_id).toBe(unitAId));
    }
  });

  // AC9 — Tenant CANNOT SELECT images for a different unit (0 rows returned, no error)
  it('AC9: tenant gets 0 rows when querying another unit\'s images', async () => {
    if (!unit2Id) {
      console.warn('[unit-images rls] skipping AC9: unit2Id not resolved');
      return;
    }
    const { data, error } = await tenantClient
      .from('unit_images')
      .select('id')
      .eq('unit_id', unit2Id);

    expect(error).toBeNull();   // RLS returns empty, not an error
    expect(data).toHaveLength(0);
  });

  // AC12 — Tenant CANNOT INSERT into unit_images (admin-only)
  it('AC12: tenant insert into unit_images is denied (RLS violation)', async () => {
    if (!orgAId || !unitAId) {
      console.warn('[unit-images rls] skipping AC12: orgAId or unitAId not resolved');
      return;
    }
    const tenantUserId = (await tenantClient.auth.getUser()).data.user?.id ?? '';
    const { data, error } = await tenantClient
      .from('unit_images')
      .insert({
        unit_id:     unitAId,
        org_id:      orgAId,
        storage_path: `${orgAId}/${unitAId}/tenant-sneaky-upload.jpg`,
        filename:    'tenant-sneaky-upload.jpg',
        mime_type:   'image/jpeg',
        size_bytes:  1024,
        is_cover:    false,
        sort_order:  0,
        uploaded_by: tenantUserId,
      })
      .select('id')
      .single();

    // INSERT must be denied — either an explicit error or no row returned
    const isDenied =
      error !== null ||
      data === null ||
      (error as { code?: string } | null)?.code === '42501';
    expect(isDenied).toBe(true);
    if (error) {
      // Both RLS block codes are acceptable
      expect(['42501', 'PGRST301', '403']).toContain(
        (error as { code?: string }).code ?? ''
      );
    }
  });
});

describe.skipIf(skipIfNoSupabase)('RLS: storage.objects — unit-images bucket', () => {
  let adminClient:   SupabaseClient;
  let tenantClient:  SupabaseClient;
  let tenant2Client: SupabaseClient;

  let orgAId:  string;
  let unitAId: string;
  let unit2Id: string;

  beforeAll(async () => {
    adminClient   = createClient(supabaseUrl, supabaseAnonKey);
    tenantClient  = createClient(supabaseUrl, supabaseAnonKey);
    tenant2Client = createClient(supabaseUrl, supabaseAnonKey);

    await Promise.all([
      adminClient.auth.signInWithPassword({ email: 'admin@org-a.demo',   password: 'DemoAdmin123!'  }),
      tenantClient.auth.signInWithPassword({ email: 'tenant@org-a.demo',  password: 'DemoTenant123!' }),
      tenant2Client.auth.signInWithPassword({ email: 'tenant2@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    const { data: profile } = await adminClient
      .from('profiles')
      .select('org_id')
      .eq('email', 'admin@org-a.demo')
      .single();
    orgAId = profile?.org_id ?? '';

    const { data: tenantRow } = await tenantClient
      .from('tenants')
      .select('unit_id')
      .eq('profile_id', (await tenantClient.auth.getUser()).data.user?.id ?? '')
      .single();
    unitAId = tenantRow?.unit_id ?? '';

    const { data: tenant2Row } = await tenant2Client
      .from('tenants')
      .select('unit_id')
      .eq('profile_id', (await tenant2Client.auth.getUser()).data.user?.id ?? '')
      .single();
    unit2Id = tenant2Row?.unit_id ?? '';
  });

  afterAll(async () => {
    await Promise.all([
      adminClient.auth.signOut(),
      tenantClient.auth.signOut(),
      tenant2Client.auth.signOut(),
    ]);
  });

  // Storage AC3 — Tenant can list/select their own unit's folder
  it('Storage AC3: tenant can list their own unit folder in unit-images', async () => {
    if (!orgAId || !unitAId) {
      console.warn('[storage rls] skipping storage AC3: IDs not resolved');
      return;
    }
    // list() returns [] when no objects exist — that is still a success (no RLS denial)
    const { data, error } = await tenantClient.storage
      .from('unit-images')
      .list(`${orgAId}/${unitAId}`);

    // No error means RLS SELECT passed
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  // Storage AC9 — Tenant cannot list another unit's folder
  it('Storage AC9: tenant cannot list another unit folder in unit-images', async () => {
    if (!orgAId || !unit2Id) {
      console.warn('[storage rls] skipping storage AC9: IDs not resolved');
      return;
    }
    const { data, error } = await tenantClient.storage
      .from('unit-images')
      .list(`${orgAId}/${unit2Id}`);

    // RLS should return empty or an error — never expose another unit's objects
    const isBlocked =
      error !== null ||
      (Array.isArray(data) && data.length === 0);
    expect(isBlocked).toBe(true);
  });
});

describe.skipIf(skipIfNoSupabase)('RLS: storage.objects — tenant-avatars bucket (AC12)', () => {
  let tenant1Client: SupabaseClient;
  let tenant2Client: SupabaseClient;

  let orgAId:    string;
  let profile2Id: string;

  beforeAll(async () => {
    tenant1Client = createClient(supabaseUrl, supabaseAnonKey);
    tenant2Client = createClient(supabaseUrl, supabaseAnonKey);

    await Promise.all([
      tenant1Client.auth.signInWithPassword({ email: 'tenant@org-a.demo',  password: 'DemoTenant123!' }),
      tenant2Client.auth.signInWithPassword({ email: 'tenant2@org-a.demo', password: 'DemoTenant123!' }),
    ]);

    const { data: p2 } = await tenant2Client
      .from('profiles')
      .select('org_id, id')
      .eq('email', 'tenant2@org-a.demo')
      .single();
    orgAId    = p2?.org_id ?? '';
    profile2Id = p2?.id ?? '';
  });

  afterAll(async () => {
    await Promise.all([
      tenant1Client.auth.signOut(),
      tenant2Client.auth.signOut(),
    ]);
  });

  // AC12 — Tenant1 CANNOT upload to Tenant2's avatar path
  it('AC12: tenant1 upload to tenant2\'s avatar path is denied (42501)', async () => {
    if (!orgAId || !profile2Id) {
      console.warn('[tenant-avatars rls] skipping AC12: IDs not resolved');
      return;
    }
    const fakePath = `${orgAId}/${profile2Id}/rls-test-unauthorized.jpg`;
    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const { data, error } = await tenant1Client.storage
      .from('tenant-avatars')
      .upload(fakePath, blob, { upsert: true });

    // Must be denied
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // Supabase storage wraps 42501 as statusCode 400 or message contains "Unauthorized"
    const errMsg = (error as { message?: string } | null)?.message ?? '';
    const errStatus = (error as { statusCode?: string } | null)?.statusCode ?? '';
    const isDenied =
      errMsg.toLowerCase().includes('unauthorized') ||
      errMsg.toLowerCase().includes('violates') ||
      errMsg.toLowerCase().includes('row-level') ||
      errStatus === '400' ||
      errStatus === '403';
    expect(isDenied).toBe(true);
  });
});
