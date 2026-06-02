import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { buildTenantActivityFeed } from '@/lib/tenants/activity-feed';
import { Tabs } from '@/components/ui/Tabs';
import { TabFallback } from '@/components/ui/TabFallback';
import { ProfileHeader } from './_components/ProfileHeader';
import { QuickActions } from './_components/QuickActions';
import { OverviewTab } from './_tabs/OverviewTab';
import { ActivityTab } from './_tabs/ActivityTab';
// Async Server Components — each self-fetches inside its own Suspense boundary
import { PaymentsTab } from './_tabs/PaymentsTab';
import { ContractsTab } from './_tabs/ContractsTab';
import { IncidentsTab } from './_tabs/IncidentsTab';
import { TasksTab } from './_tabs/TasksTab';
import { WhatsAppTab } from './_tabs/WhatsAppTab';
import { DocumentsTab } from './_tabs/DocumentsTab';
import { SanctionsTab } from './_tabs/SanctionsTab';
import { NotesTab } from './_tabs/NotesTab';

export const metadata: Metadata = { title: 'Tenant Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  // Fetch tenant (RLS ensures org isolation — 404 if wrong org)
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*, units(label, properties(name))')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) notFound();

  const unit = tenant.units as { label: string; properties: { name: string } | null } | null;

  // Eager fetches for the Overview tab and the activity feed builder.
  // These are the only queries that block the initial page shell — all other
  // tab data is deferred to per-tab async Server Components inside <Suspense>.
  const [
    statementRes,
    // Minimal parallel queries needed by OverviewTab + activityFeed
    incidentsRes,
    tasksRes,
    sanctionsRes,
    paymentsRes,
    waConvRes,
  ] = await Promise.all([
    supabase.from('tenant_statement').select('*').eq('tenant_id', id).single(),
    supabase.from('incidents').select('id, title, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('tenant_tasks').select('id, title, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('sanctions').select('id, title, kind, amount, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('payments').select('id, amount, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('paid_at', { ascending: false }).limit(50),
    supabase.from('whatsapp_conversations').select('id, external_phone').eq('tenant_id', id).eq('org_id', ctx.orgId).limit(1).single(),
  ]);

  const statement = statementRes.data ?? null;
  const incidents = incidentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const sanctions = sanctionsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const conversation = waConvRes.data ?? null;

  // WhatsApp messages for the last-message summary in OverviewTab
  let waMessages: { id: string; direction: string; body: string | null; classification: string | null; status: string; created_at: string }[] = [];
  if (conversation) {
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, body, classification, status, created_at')
      .eq('conversation_id', conversation.id)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(1);
    waMessages = msgs ?? [];
  }

  // Signed URL for avatar
  let avatarSignedUrl: string | null = null;
  if (tenant.photo_url) {
    const { data: urlData } = await supabase.storage
      .from('tenant-avatars')
      .createSignedUrl(tenant.photo_url, 3600);
    avatarSignedUrl = urlData?.signedUrl ?? null;
  }

  // Activity feed — built in memory from already-fetched arrays (AC3).
  // Only whatsapp_messages is still queried inside buildTenantActivityFeed
  // because it needs a conversation join that differs from the page-level fetch.
  const activityEvents = await buildTenantActivityFeed({
    supabase,
    tenantId: id,
    orgId: ctx.orgId,
    payments,
    incidents,
    tasks,
    sanctions,
  });

  // Derived counts for overview tab badges
  const activeContract = null; // Computed eagerly only if needed for overview — contracts tab self-fetches
  const activeIncidentsCount = incidents.filter((i) => ['open', 'in_progress'].includes(i.status)).length;
  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;
  const lastWaMessage = waMessages.length > 0 ? waMessages[0] : null;

  // Tab definitions — overview and activity render eagerly as part of the page
  // shell; all other tabs are wrapped in <Suspense> so they stream independently.
  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <OverviewTab
          statement={statement}
          activeContract={activeContract}
          activeIncidentsCount={activeIncidentsCount}
          pendingTasksCount={pendingTasksCount}
          lastWhatsAppMessage={lastWaMessage}
          tenantId={id}
        />
      ),
    },
    {
      id: 'payments',
      label: 'Payments',
      content: (
        <Suspense fallback={<TabFallback />}>
          <PaymentsTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'contracts',
      label: 'Contracts',
      content: (
        <Suspense fallback={<TabFallback />}>
          <ContractsTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'incidents',
      label: 'Incidents',
      badge: activeIncidentsCount,
      content: (
        <Suspense fallback={<TabFallback />}>
          <IncidentsTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'tasks',
      label: 'Tasks',
      badge: pendingTasksCount,
      content: (
        <Suspense fallback={<TabFallback />}>
          <TasksTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      content: (
        <Suspense fallback={<TabFallback />}>
          <WhatsAppTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'documents',
      label: 'Documents',
      content: (
        <Suspense fallback={<TabFallback />}>
          <DocumentsTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'sanctions',
      label: 'Sanctions',
      content: (
        <Suspense fallback={<TabFallback />}>
          <SanctionsTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'notes',
      label: 'Notes',
      content: (
        <Suspense fallback={<TabFallback />}>
          <NotesTab tenantId={id} />
        </Suspense>
      ),
    },
    {
      id: 'activity',
      label: 'Activity',
      content: <ActivityTab events={activityEvents} />,
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Profile header */}
      <ProfileHeader
        tenant={tenant}
        unit={unit}
        statement={statement}
        avatarSignedUrl={avatarSignedUrl}
        orgId={ctx.orgId}
      />

      {/* Quick actions */}
      <QuickActions tenantId={id} />

      {/* Tabs — non-overview tabs stream via Suspense boundaries */}
      <Tabs tabs={tabs} defaultTab="overview" className="bg-white border border-slate-200 rounded-xl overflow-hidden" />
    </div>
  );
}
