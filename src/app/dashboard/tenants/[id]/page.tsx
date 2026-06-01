import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTenantActivityFeed } from '@/lib/tenants/activity-feed';
import { Tabs } from '@/components/ui/Tabs';
import { ProfileHeader } from './_components/ProfileHeader';
import { QuickActions } from './_components/QuickActions';
import { OverviewTab } from './_tabs/OverviewTab';
import { PaymentsTab } from './_tabs/PaymentsTab';
import { ContractsTab } from './_tabs/ContractsTab';
import { IncidentsTab } from './_tabs/IncidentsTab';
import { TasksTab } from './_tabs/TasksTab';
import { WhatsAppTab } from './_tabs/WhatsAppTab';
import { DocumentsTab } from './_tabs/DocumentsTab';
import { SanctionsTab } from './_tabs/SanctionsTab';
import { NotesTab } from './_tabs/NotesTab';
import { ActivityTab } from './_tabs/ActivityTab';

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

  // Parallel data fetch for all tabs
  const [
    contractsRes,
    paymentsRes,
    chargesRes,
    statementRes,
    incidentsRes,
    tasksRes,
    sanctionsRes,
    notesRes,
    receiptsRes,
    signatureReqRes,
    waConvRes,
  ] = await Promise.all([
    supabase.from('contracts').select('*').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }),
    supabase.from('payments').select('*').eq('tenant_id', id).eq('org_id', ctx.orgId).order('paid_at', { ascending: false }).limit(50),
    supabase.from('charges').select('*').eq('tenant_id', id).eq('org_id', ctx.orgId).order('due_date', { ascending: false }).limit(50),
    supabase.from('tenant_statement').select('*').eq('tenant_id', id).single(),
    supabase.from('incidents').select('id, title, category, priority, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('tenant_tasks').select('id, title, task_type, status, due_at, completed_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('sanctions').select('id, kind, title, reason, amount, status, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('internal_notes').select('id, content, created_by, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('payment_receipts').select('id, source, status, extracted_amount, confidence, created_at').eq('tenant_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(20),
    supabase.from('signature_requests').select('id, signer_email, status, sent_at').eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(20),
    supabase.from('whatsapp_conversations').select('id, external_phone').eq('tenant_id', id).eq('org_id', ctx.orgId).limit(1).single(),
  ]);

  const contracts = contractsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const charges = chargesRes.data ?? [];
  const statement = statementRes.data ?? null;
  const incidents = incidentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const sanctions = sanctionsRes.data ?? [];
  const notes = notesRes.data ?? [];
  const receipts = receiptsRes.data ?? [];
  const signatureRequests = signatureReqRes.data ?? [];
  const conversation = waConvRes.data ?? null;

  // WhatsApp messages for this conversation
  let waMessages: { id: string; direction: string; body: string | null; classification: string | null; status: string; created_at: string }[] = [];
  if (conversation) {
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, body, classification, status, created_at')
      .eq('conversation_id', conversation.id)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(100);
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

  // Activity feed
  const activityEvents = await getTenantActivityFeed(supabase, id, ctx.orgId);

  // Derived counts
  const activeContract = contracts.find((c) => c.status === 'active') ?? null;
  const activeIncidentsCount = incidents.filter((i) => ['open', 'in_progress'].includes(i.status)).length;
  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;
  const lastWaMessage = waMessages.length > 0 ? waMessages[0] : null;

  // Tab definitions
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
      badge: payments.filter((p) => p.status === 'pending').length,
      content: <PaymentsTab payments={payments} charges={charges} statement={statement} receipts={receipts} />,
    },
    {
      id: 'contracts',
      label: 'Contracts',
      content: <ContractsTab contracts={contracts} />,
    },
    {
      id: 'incidents',
      label: 'Incidents',
      badge: activeIncidentsCount,
      content: <IncidentsTab incidents={incidents} />,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      badge: pendingTasksCount,
      content: <TasksTab tasks={tasks} />,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      badge: conversation ? undefined : undefined,
      content: <WhatsAppTab conversation={conversation} messages={waMessages} />,
    },
    {
      id: 'documents',
      label: 'Documents',
      content: <DocumentsTab signatureRequests={signatureRequests} contractCount={contracts.length} />,
    },
    {
      id: 'sanctions',
      label: 'Sanctions',
      badge: sanctions.filter((s) => s.status === 'disputed').length,
      content: <SanctionsTab sanctions={sanctions} />,
    },
    {
      id: 'notes',
      label: 'Notes',
      badge: notes.length,
      content: <NotesTab notes={notes} tenantId={id} />,
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

      {/* Tabs */}
      <Tabs tabs={tabs} defaultTab="overview" className="bg-white border border-slate-200 rounded-xl overflow-hidden" />
    </div>
  );
}
