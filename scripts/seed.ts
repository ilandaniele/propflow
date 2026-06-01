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
  // Create Organizations (idempotent — upsert by slug)
  // IC6: bare .insert() fails on re-run; .upsert() with onConflict:'slug' is safe.
  // ============================================================
  const { data: orgA, error: orgAErr } = await supabase
    .from('organizations')
    .upsert({ name: 'Org A — Demo Properties', slug: 'org-a-demo' }, { onConflict: 'slug' })
    .select()
    .single();
  if (orgAErr) { console.error('[seed] orgA error:', orgAErr.message); process.exit(1); }

  const { data: orgB, error: orgBErr } = await supabase
    .from('organizations')
    .upsert({ name: 'Org B — Isolation Test', slug: 'org-b-isolation' }, { onConflict: 'slug' })
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
      if (authErr.message.toLowerCase().includes('registered') || authErr.message.toLowerCase().includes('already exists')) {
        // IC6 fix: when user already exists, look up their id and STILL upsert the profile.
        // Old code `continue`d here — leaving auth users with no profiles row (the root cause
        // of "admin@org-a.demo can't log in" because requireUser() queries profiles first).
        console.log(`[seed] User ${u.email} already exists — looking up id for profile upsert`);
        const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
        if (listErr) {
          console.error(`[seed] Could not list users to find ${u.email}:`, listErr.message);
          process.exit(1);
        }
        const existingUser = listData.users.find((usr: { email?: string }) => usr.email === u.email);
        if (!existingUser) {
          console.error(`[seed] User ${u.email} not found in listUsers after "already registered"`);
          process.exit(1);
        }
        createdUsers[u.email] = existingUser.id;
        console.log(`[seed] Found existing user: ${u.email} (${existingUser.id})`);
      } else {
        console.error(`[seed] Error creating ${u.email}:`, authErr.message);
        process.exit(1);
      }
    } else {
      createdUsers[u.email] = authUser.user!.id;
      console.log(`[seed] Created user: ${u.email} (${u.role}, ${u.orgId === orgA.id ? 'Org A' : 'Org B'})`);
    }

    // Always upsert profile (idempotent) — covers both new and pre-existing users.
    // IC6 fix: old code only ran this block when createUser succeeded, leaving
    // pre-existing auth users without a profiles row.
    const userId = createdUsers[u.email];
    if (userId) {
      const { error: profileErr } = await supabase.from('profiles').upsert({
        id: userId,
        org_id: u.orgId,
        role: u.role as 'admin' | 'tenant',
        full_name: u.name,
        email: u.email,
      }, { onConflict: 'id' });
      if (profileErr) {
        console.error(`[seed] Profile upsert failed for ${u.email}:`, profileErr.message);
        process.exit(1);
      }
      console.log(`[seed] Profile upserted: ${u.email}`);
    }
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

  let unitB: { id: string } | null = null;
  if (propB) {
    const { data: ub } = await supabase.from('units').insert({ org_id: orgB.id, property_id: propB.id, label: 'Unit B1', status: 'vacant' }).select().single();
    unitB = ub;
  }

  // ============================================================
  // Phase 2 seed data — one row per new table for RLS isolation tests
  // ============================================================
  console.log('[seed] Seeding Phase 2 tables...');

  // expense_categories
  const { data: catA } = await supabase.from('expense_categories').insert({ org_id: orgA.id, name: 'Maintenance', color: '#3b82f6' }).select().single();
  const { data: catB } = await supabase.from('expense_categories').insert({ org_id: orgB.id, name: 'Utilities (B)', color: '#ef4444' }).select().single();

  // expenses
  const { data: expA } = await supabase.from('expenses').insert({
    org_id: orgA.id, property_id: property.id, category_id: catA?.id ?? null,
    amount: 250, description: 'Plumber visit', incurred_on: today,
  }).select().single();
  if (catB) {
    await supabase.from('expenses').insert({
      org_id: orgB.id, category_id: catB.id, amount: 100, description: 'Electric bill (B)', incurred_on: today,
    });
  }

  // receipt_uploads (Org A admin profile)
  const adminUserId2 = createdUsers['admin@org-a.demo'];
  if (adminUserId2) {
    await supabase.from('receipt_uploads').insert({
      org_id: orgA.id, uploaded_by: adminUserId2,
      file_path: `${orgA.id}/uploads/demo-receipt.jpg`, ocr_status: 'pending',
    });
  }
  const adminBId = createdUsers['admin@org-b.demo'];
  if (adminBId) {
    await supabase.from('receipt_uploads').insert({
      org_id: orgB.id, uploaded_by: adminBId,
      file_path: `${orgB.id}/uploads/demo-receipt-b.jpg`, ocr_status: 'pending',
    });
  }

  // contract_templates
  const { data: templateA } = await supabase.from('contract_templates').insert({
    org_id: orgA.id, name: 'Standard Lease',
    body_markdown: '## Rental Agreement\n\nThis agreement is between {{org_name}} and {{tenant_name}}.\n\nUnit: {{unit_label}}\nProperty: {{property_name}}\nStart: {{start_date}}\nEnd: {{end_date}}\nMonthly Rent: ${{monthly_rent}}\n',
    variables: ['tenant_name', 'unit_label', 'property_name', 'start_date', 'end_date', 'monthly_rent', 'org_name'],
  }).select().single();
  await supabase.from('contract_templates').insert({
    org_id: orgB.id, name: 'Standard Lease (B)',
    body_markdown: '## Lease\n\nTenant: {{tenant_name}}\n',
    variables: ['tenant_name'],
  });

  // pricing_tables
  await supabase.from('pricing_tables').insert({
    org_id: orgA.id, name: 'Downtown 2025', property_type: 'apartment', market_zone: 'downtown',
    tiers: [{ label: '1BR', bedrooms: 1, min_rent: 1200, max_rent: 1800, suggested_rent: 1500 }, { label: '2BR', bedrooms: 2, min_rent: 1500, max_rent: 2200, suggested_rent: 1800 }],
  });
  await supabase.from('pricing_tables').insert({
    org_id: orgB.id, name: 'Suburbs 2025 (B)', property_type: 'house', market_zone: 'suburbs',
    tiers: [{ label: '3BR', bedrooms: 3, min_rent: 1800, max_rent: 2500, suggested_rent: 2100 }],
  });

  // signature_requests (for Org A contract)
  const sigExpiry = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  await supabase.from('signature_requests').insert({
    org_id: orgA.id, contract_id: contract.id,
    signer_email: 'tenant@org-a.demo', expires_at: sigExpiry, status: 'sent',
  });

  // announcements
  const now2 = new Date().toISOString();
  const { data: annA } = await supabase.from('announcements').insert({
    org_id: orgA.id, created_by: adminUserId2 ?? '', title: 'Welcome to PropFlow!',
    body: 'This is a demo announcement for Org A tenants.', audience: 'all',
    published_at: now2,
  }).select().single();
  await supabase.from('announcements').insert({
    org_id: orgB.id, created_by: adminBId ?? '', title: 'Org B Notice',
    body: 'This is Org B only.', audience: 'all', published_at: now2,
  });

  // cleaning_tasks
  await supabase.from('cleaning_tasks').insert({
    org_id: orgA.id, unit_id: unit.id, title: 'Deep clean unit 1A', scheduled_date: today, status: 'pending',
  });
  if (unitB) {
    await supabase.from('cleaning_tasks').insert({
      org_id: orgB.id, unit_id: unitB.id, title: 'Clean unit B1', scheduled_date: today, status: 'pending',
    });
  }

  // crm_leads
  await supabase.from('crm_leads').insert({
    org_id: orgA.id, full_name: 'Prospective Tenant A', email: 'prospect@example.com',
    status: 'new', source: 'Website',
  });
  await supabase.from('crm_leads').insert({
    org_id: orgB.id, full_name: 'Prospect B', status: 'contacted',
  });

  // reminders
  await supabase.from('reminders').insert({
    org_id: orgA.id, type: 'payment_due', target_type: 'charge',
    target_id: contract.id, scheduled_for: today, status: 'scheduled',
    message_preview: 'Payment due reminder',
  });

  // notification_inbox
  const tenantUserId2 = createdUsers['tenant@org-a.demo'];
  const tenantBId = createdUsers['tenant@org-b.demo'];
  if (tenantUserId2) {
    await supabase.from('notification_inbox').insert({
      org_id: orgA.id, profile_id: tenantUserId2, type: 'announcement',
      title: 'Welcome to PropFlow!', body: 'This is a demo announcement.',
    });
  }
  if (tenantBId) {
    await supabase.from('notification_inbox').insert({
      org_id: orgB.id, profile_id: tenantBId, type: 'announcement',
      title: 'Org B Notice', body: 'This is Org B only.',
    });
  }

  // community_posts
  if (tenantUserId2) {
    await supabase.from('community_posts').insert({
      org_id: orgA.id, author_id: tenantUserId2, title: 'Hello neighbors!',
      body: 'Looking forward to community events.', category: 'general', pinned: false,
    });
  }
  if (tenantBId) {
    await supabase.from('community_posts').insert({
      org_id: orgB.id, author_id: tenantBId, title: 'Org B post',
      body: 'This is Org B community.', category: 'general', pinned: false,
    });
  }

  // visitor_logs
  if (adminUserId2) {
    await supabase.from('visitor_logs').insert({
      org_id: orgA.id, unit_id: unit.id, visitor_name: 'John Visitor',
      visit_date: today, created_by: adminUserId2, purpose: 'Guest',
    });
  }
  if (adminBId && unitB) {
    await supabase.from('visitor_logs').insert({
      org_id: orgB.id, unit_id: unitB.id, visitor_name: 'Visitor B',
      visit_date: today, created_by: adminBId,
    });
  }

  // ai_chat_messages
  if (adminUserId2) {
    const sessionId = '00000000-0000-0000-0000-000000000001';
    await supabase.from('ai_chat_messages').insert([
      { org_id: orgA.id, profile_id: adminUserId2, session_id: sessionId, role: 'user', content: 'What is my occupancy rate?' },
      { org_id: orgA.id, profile_id: adminUserId2, session_id: sessionId, role: 'assistant', content: 'Your current occupancy is 100% (1 of 1 units occupied).' },
    ]);
  }
  if (adminBId) {
    const sessionIdB = '00000000-0000-0000-0000-000000000002';
    await supabase.from('ai_chat_messages').insert([
      { org_id: orgB.id, profile_id: adminBId, session_id: sessionIdB, role: 'user', content: 'Org B question' },
      { org_id: orgB.id, profile_id: adminBId, session_id: sessionIdB, role: 'assistant', content: 'Org B answer' },
    ]);
  }

  console.log('[seed] Phase 2 tables seeded.');
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
