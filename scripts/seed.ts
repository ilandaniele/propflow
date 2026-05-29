/**
 * PropFlow Seed Script — DEV/STAGING ONLY
 *
 * Creates:
 *   - 2 organizations (Org A, Org B) — for isolation testing
 *   - 1 admin + 1 tenant per org (4 users total)
 *   - Properties, units, contracts, charges for Org A
 *
 * NEVER run against production automatically.
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in env.
 *
 * Run: npx tsx scripts/seed.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[seed] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Service-role client bypasses RLS (seed only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('[seed] Starting PropFlow demo seed...');

  // ============================================================
  // Create Organizations
  // ============================================================
  const { data: orgA, error: orgAErr } = await supabase
    .from('organizations')
    .insert({ name: 'Org A — Demo Properties', slug: 'org-a-demo' })
    .select()
    .single();
  if (orgAErr) { console.error('[seed] orgA error:', orgAErr.message); process.exit(1); }

  const { data: orgB, error: orgBErr } = await supabase
    .from('organizations')
    .insert({ name: 'Org B — Isolation Test', slug: 'org-b-isolation' })
    .select()
    .single();
  if (orgBErr) { console.error('[seed] orgB error:', orgBErr.message); process.exit(1); }

  console.log(`[seed] Orgs created: ${orgA.id} (A), ${orgB.id} (B)`);

  // ============================================================
  // Create Auth Users + Profiles
  // ============================================================
  const users = [
    { email: 'admin@org-a.demo', password: 'DemoAdmin123!', role: 'admin', orgId: orgA.id, name: 'Alex Admin' },
    { email: 'tenant@org-a.demo', password: 'DemoTenant123!', role: 'tenant', orgId: orgA.id, name: 'Tina Tenant' },
    { email: 'admin@org-b.demo', password: 'DemoAdmin123!', role: 'admin', orgId: orgB.id, name: 'Bob Admin (B)' },
    { email: 'tenant@org-b.demo', password: 'DemoTenant123!', role: 'tenant', orgId: orgB.id, name: 'Tom Tenant (B)' },
  ];

  const createdUsers: Record<string, string> = {};

  for (const u of users) {
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      app_metadata: { org_id: u.orgId, role: u.role },
      user_metadata: { full_name: u.name },
    });

    if (authErr) {
      if (authErr.message.includes('already registered')) {
        console.log(`[seed] User ${u.email} already exists, skipping`);
        continue;
      }
      console.error(`[seed] Error creating ${u.email}:`, authErr.message);
      process.exit(1);
    }

    createdUsers[u.email] = authUser.user!.id;
    console.log(`[seed] Created user: ${u.email} (${u.role}, ${u.orgId === orgA.id ? 'Org A' : 'Org B'})`);

    // Upsert profile (trigger should have created it, but ensure it exists)
    await supabase.from('profiles').upsert({
      id: authUser.user!.id,
      org_id: u.orgId,
      role: u.role as 'admin' | 'tenant',
      full_name: u.name,
      email: u.email,
    });
  }

  // ============================================================
  // Org A: Property, Unit, Tenant record, Contract, Charges
  // ============================================================
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .insert({ org_id: orgA.id, name: 'Demo Apartments', address: '123 Demo Street', city: 'San Francisco', country: 'US' })
    .select()
    .single();
  if (propErr) { console.error('[seed] property error:', propErr.message); process.exit(1); }

  const { data: unit, error: unitErr } = await supabase
    .from('units')
    .insert({ org_id: orgA.id, property_id: property.id, label: 'Apt 1A', floor: '1', bedrooms: 2, monthly_rent_default: 1500, status: 'occupied' })
    .select()
    .single();
  if (unitErr) { console.error('[seed] unit error:', unitErr.message); process.exit(1); }

  const tenantUserId = createdUsers['tenant@org-a.demo'];
  const { data: tenantRecord, error: tenantErr } = await supabase
    .from('tenants')
    .insert({
      org_id: orgA.id,
      profile_id: tenantUserId ?? null,
      full_name: 'Tina Tenant',
      email: 'tenant@org-a.demo',
      unit_id: unit.id,
    })
    .select()
    .single();
  if (tenantErr) { console.error('[seed] tenant record error:', tenantErr.message); process.exit(1); }

  const today = new Date().toISOString().split('T')[0];
  const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const { data: contract, error: contractErr } = await supabase
    .from('contracts')
    .insert({
      org_id: orgA.id,
      tenant_id: tenantRecord.id,
      unit_id: unit.id,
      start_date: today,
      end_date: nextYear,
      monthly_rent: 1500,
      deposit: 3000,
      status: 'active',
    })
    .select()
    .single();
  if (contractErr) { console.error('[seed] contract error:', contractErr.message); process.exit(1); }

  // Past-due charge to demonstrate overdue tenant
  const lastMonth = new Date(Date.now() - 32 * 24 * 3600 * 1000);
  const lastMonthStr = lastMonth.toISOString().split('T')[0];

  await supabase.from('charges').insert([
    {
      org_id: orgA.id,
      contract_id: contract.id,
      tenant_id: tenantRecord.id,
      amount: 1500,
      description: 'Rent - last month',
      period: lastMonthStr,
      due_date: lastMonthStr,
    },
    {
      org_id: orgA.id,
      contract_id: contract.id,
      tenant_id: tenantRecord.id,
      amount: 1500,
      description: `Rent - ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}`,
      period: today.slice(0, 7) + '-01',
      due_date: today.slice(0, 7) + '-05',
    },
  ]);

  // Approved payment for last month (partial)
  const adminUserId = createdUsers['admin@org-a.demo'];
  await supabase.from('payments').insert({
    org_id: orgA.id,
    contract_id: contract.id,
    tenant_id: tenantRecord.id,
    amount: 1000,
    paid_at: lastMonthStr,
    method: 'transfer',
    status: 'approved',
    approved_by: adminUserId ?? null,
    approved_at: new Date().toISOString(),
    reference: 'TXN-DEMO-001',
  });

  // Pending payment for this month
  await supabase.from('payments').insert({
    org_id: orgA.id,
    contract_id: contract.id,
    tenant_id: tenantRecord.id,
    amount: 1500,
    paid_at: today,
    method: 'transfer',
    status: 'pending',
    reference: 'TXN-DEMO-002',
  });

  // Open incident
  const adminProfileId = adminUserId;
  await supabase.from('incidents').insert({
    org_id: orgA.id,
    unit_id: unit.id,
    property_id: property.id,
    created_by: tenantUserId ?? adminProfileId!,
    tenant_id: tenantRecord.id,
    category: 'plumbing',
    title: 'Leaking faucet in kitchen',
    description: 'The kitchen faucet has been dripping since Monday. Water is pooling under the sink.',
    priority: 'high',
    status: 'pending',
  });

  // ============================================================
  // Org B: minimal data for isolation testing
  // ============================================================
  const { data: propB } = await supabase
    .from('properties')
    .insert({ org_id: orgB.id, name: 'Org B Building', address: '456 Test Ave', city: 'Portland', country: 'US' })
    .select()
    .single();

  if (propB) {
    await supabase.from('units').insert({ org_id: orgB.id, property_id: propB.id, label: 'Unit B1', status: 'vacant' });
  }

  console.log('\n[seed] Done! Demo credentials:');
  console.log('  Admin (Org A):  admin@org-a.demo  /  DemoAdmin123!');
  console.log('  Tenant (Org A): tenant@org-a.demo /  DemoTenant123!');
  console.log('  Admin (Org B):  admin@org-b.demo  /  DemoAdmin123!');
  console.log('  Tenant (Org B): tenant@org-b.demo /  DemoTenant123!');
}

main().catch((err) => {
  console.error('[seed] Fatal:', err);
  process.exit(1);
});
