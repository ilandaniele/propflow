import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Tabs } from '@/components/ui/Tabs';
import { UnitHeader } from './_components/UnitHeader';
import { UnitOverviewTab } from './_tabs/UnitOverviewTab';
import { UnitTenantTab } from './_tabs/UnitTenantTab';
import { UnitPaymentsTab } from './_tabs/UnitPaymentsTab';
import { UnitIncidentsTab } from './_tabs/UnitIncidentsTab';

export const metadata: Metadata = { title: 'Unit Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function UnitDetailPage({ params }: Props) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  // Fetch unit (RLS enforces org isolation — 404 if wrong org)
  const { data: unit } = await supabase
    .from('units')
    .select('*, properties(name)')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!unit) notFound();

  const unitWithProperty = unit as typeof unit & { properties: { name: string } | null };

  // Fetch current tenant for this unit
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('id, full_name, email, phone, profile_id')
    .eq('unit_id', id)
    .eq('org_id', ctx.orgId)
    .limit(1)
    .single();

  const tenant = tenantData ?? null;

  // Fetch additional data only if tenant exists
  let payments: {
    id: string;
    amount: number;
    paid_at: string;
    method: string;
    status: string;
    reference?: string | null;
  }[] = [];

  let incidents: {
    id: string;
    title: string;
    category: string;
    priority: string;
    status: string;
    created_at: string;
  }[] = [];

  let statement: {
    total_charges: number;
    total_approved_payments: number;
    balance: number;
    is_overdue: boolean;
  } | null = null;

  let activeContract: {
    start_date: string;
    monthly_rent: number;
    status: string;
  } | null = null;

  if (tenant) {
    const [paymentsRes, incidentsRes, statementRes, contractRes] = await Promise.all([
      supabase
        .from('payments')
        .select('id, amount, paid_at, method, status, reference')
        .eq('tenant_id', tenant.id)
        .order('paid_at', { ascending: false })
        .limit(20),
      supabase
        .from('incidents')
        .select('id, title, category, priority, status, created_at')
        .eq('unit_id', id)
        .eq('org_id', ctx.orgId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('tenant_statement')
        .select('total_charges, total_approved_payments, balance, is_overdue')
        .eq('tenant_id', tenant.id)
        .single(),
      supabase
        .from('contracts')
        .select('start_date, monthly_rent, status')
        .eq('tenant_id', tenant.id)
        .eq('org_id', ctx.orgId)
        .eq('status', 'active')
        .limit(1)
        .single(),
    ]);

    payments = paymentsRes.data ?? [];
    incidents = incidentsRes.data ?? [];
    statement = statementRes.data ?? null;
    activeContract = contractRes.data ?? null;
  } else {
    // Fetch incidents for the unit even without a tenant
    const { data: incidentsData } = await supabase
      .from('incidents')
      .select('id, title, category, priority, status, created_at')
      .eq('unit_id', id)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(20);
    incidents = incidentsData ?? [];
  }

  // Derived counts
  const pendingPaymentCount = payments.filter((p) => p.status === 'pending').length;
  const openIncidentCount = incidents.filter((i) =>
    ['open', 'in_progress', 'pending'].includes(i.status)
  ).length;

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <UnitOverviewTab
          tenant={tenant}
          statement={statement}
          pendingPaymentCount={pendingPaymentCount}
          openIncidentCount={openIncidentCount}
        />
      ),
    },
    {
      id: 'tenant',
      label: 'Tenant',
      content: <UnitTenantTab tenant={tenant} activeContract={activeContract} />,
    },
    {
      id: 'payments',
      label: 'Payments',
      badge: pendingPaymentCount,
      content: <UnitPaymentsTab payments={payments} />,
    },
    {
      id: 'incidents',
      label: 'Incidents',
      badge: openIncidentCount,
      content: <UnitIncidentsTab incidents={incidents} />,
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Back link */}
      <Link
        href="/dashboard/units"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Units
      </Link>

      {/* Unit header */}
      <UnitHeader unit={unitWithProperty} />

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        defaultTab="overview"
        ariaLabel="Unit detail tabs"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      />
    </div>
  );
}
