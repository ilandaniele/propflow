import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { tenants, units, properties, incidents, payments, whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { buildTenantActivityFeed } from '@/lib/tenants/activity-feed';
import { Tabs } from '@/components/ui/Tabs';
import { TabFallback } from '@/components/ui/TabFallback';
import { ProfileHeader } from './_components/ProfileHeader';
import { QuickActions } from './_components/QuickActions';
import { LinkPortalAccount } from './LinkPortalAccount';
import { OverviewTab } from './_tabs/OverviewTab';
import { ActivityTab } from './_tabs/ActivityTab';
import { PaymentsTab } from './_tabs/PaymentsTab';
import { ContractsTab } from './_tabs/ContractsTab';
import { IncidentsTab } from './_tabs/IncidentsTab';
import { TasksTab } from './_tabs/TasksTab';
import { WhatsAppTab } from './_tabs/WhatsAppTab';
import { DocumentsTab } from './_tabs/DocumentsTab';
import { SanctionsTab } from './_tabs/SanctionsTab';
import { NotesTab } from './_tabs/NotesTab';
import { PortalPreviewTab } from './_tabs/PortalPreviewTab';

export const metadata: Metadata = { title: 'Tenant Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  // Fetch tenant row with unit + property via separate queries
  const tenantRow = await db.select({
    id: tenants.id,
    orgId: tenants.orgId,
    fullName: tenants.fullName,
    email: tenants.email,
    phone: tenants.phone,
    unitId: tenants.unitId,
    profileId: tenants.profileId,
    photoUrl: tenants.photoUrl,
    whatsappPhone: tenants.whatsappPhone,
    portalAccess: tenants.portalAccess,
    notes: tenants.notes,
    moveInDate: tenants.moveInDate,
    preferredLanguage: tenants.preferredLanguage,
    createdAt: tenants.createdAt,
  })
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.orgId, ctx.orgId)))
    .then((r) => r[0] ?? null);

  if (!tenantRow) notFound();

  // Fetch unit + property info
  let unit: { label: string; properties: { name: string } | null } | null = null;
  if (tenantRow.unitId) {
    const unitRow = await db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, tenantRow.unitId))
      .then((r) => r[0] ?? null);
    if (unitRow) {
      const propertyRow = await db.select({ name: properties.name })
        .from(properties)
        .where(eq(properties.id, unitRow.propertyId))
        .then((r) => r[0] ?? null);
      unit = { label: unitRow.label, properties: propertyRow ? { name: propertyRow.name } : null };
    }
  }

  // Eager fetches for Overview tab + activity feed
  const [incidentRows, paymentRows, waConvRows] = await Promise.all([
    db.select({ id: incidents.id, title: incidents.title, status: incidents.status, createdAt: incidents.createdAt })
      .from(incidents)
      .where(and(eq(incidents.tenantId, id), eq(incidents.orgId, ctx.orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(50),
    db.select({ id: payments.id, amount: payments.amount, status: payments.status, createdAt: payments.createdAt })
      .from(payments)
      .where(and(eq(payments.tenantId, id), eq(payments.orgId, ctx.orgId)))
      .orderBy(desc(payments.createdAt))
      .limit(50),
    db.select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.tenantId, id), eq(whatsappConversations.orgId, ctx.orgId)))
      .limit(1),
  ]);

  const conversation = waConvRows[0] ?? null;

  // tenant_statement is a DB VIEW — raw SQL
  type TenantStmtRow = { is_overdue: boolean; balance: string | null; total_charges: string | null; total_approved_payments: string | null };
  const stmtRows: TenantStmtRow[] = Array.from(await db.execute<TenantStmtRow>(
    sql`SELECT is_overdue, balance, total_charges, total_approved_payments FROM tenant_statement WHERE tenant_id = ${id} LIMIT 1`
  ));
  const rawStmt = stmtRows[0] ?? null;
  // Convert string fields to numbers for component compatibility
  const statement = rawStmt ? {
    is_overdue: rawStmt.is_overdue,
    balance: Number(rawStmt.balance ?? 0),
    total_charges: Number(rawStmt.total_charges ?? 0),
    total_approved_payments: Number(rawStmt.total_approved_payments ?? 0),
  } : null;

  // WhatsApp last message
  let waMessages: { id: string; direction: string; body: string | null; classification: string | null; status: string; created_at: string }[] = [];
  if (conversation) {
    const msgRows = await db.select({
      id: whatsappMessages.id,
      direction: whatsappMessages.direction,
      body: whatsappMessages.body,
      classification: whatsappMessages.classification,
      status: whatsappMessages.status,
      createdAt: whatsappMessages.createdAt,
    })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.conversationId, conversation.id), eq(whatsappMessages.orgId, ctx.orgId)))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);
    waMessages = msgRows.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      classification: m.classification,
      status: m.status,
      created_at: m.createdAt.toISOString(),
    }));
  }

  // Signed URL for avatar — still uses Supabase Storage
  let avatarSignedUrl: string | null = null;
  if (tenantRow.photoUrl) {
    const supabase = await createClient();
    const { data: urlData } = await supabase.storage
      .from('tenant-avatars')
      .createSignedUrl(tenantRow.photoUrl, 3600);
    avatarSignedUrl = urlData?.signedUrl ?? null;
  }

  // Activity feed — still requires supabase for WhatsApp messages internal query
  const supabase = await createClient();
  const activityEvents = await buildTenantActivityFeed({
    supabase,
    tenantId: id,
    orgId: ctx.orgId,
    payments: paymentRows.map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      created_at: p.createdAt.toISOString(),
    })),
    incidents: incidentRows.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      created_at: i.createdAt.toISOString(),
    })),
    tasks: [],   // TasksTab self-fetches
    sanctions: [], // SanctionsTab self-fetches
  });

  // Derived counts for overview tab badges
  const activeIncidentsCount = incidentRows.filter((i) => ['open', 'in_progress'].includes(i.status)).length;
  const lastWaMessage = waMessages.length > 0 ? waMessages[0] : null;

  // Shape tenant for existing profile components (snake_case compat)
  const tenantForComponents = {
    ...tenantRow,
    full_name: tenantRow.fullName,
    org_id: tenantRow.orgId,
    unit_id: tenantRow.unitId,
    profile_id: tenantRow.profileId,
    photo_url: tenantRow.photoUrl,
    whatsapp_phone: tenantRow.whatsappPhone,
    portal_access: tenantRow.portalAccess,
    move_in_date: tenantRow.moveInDate,
    preferred_language: tenantRow.preferredLanguage,
    created_at: tenantRow.createdAt.toISOString(),
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <OverviewTab
          statement={statement}
          activeContract={null}
          activeIncidentsCount={activeIncidentsCount}
          pendingTasksCount={0}
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
      badge: 0,
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
    {
      id: 'portal-preview',
      label: 'Portal Preview',
      content: (
        <Suspense fallback={<TabFallback />}>
          <PortalPreviewTab tenant={tenantForComponents as Parameters<typeof PortalPreviewTab>[0]['tenant']} />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      <ProfileHeader
        tenant={tenantForComponents as Parameters<typeof ProfileHeader>[0]['tenant']}
        unit={unit}
        statement={statement}
        avatarSignedUrl={avatarSignedUrl}
        orgId={ctx.orgId}
      />

      <QuickActions tenantId={id} />

      {!tenantRow.profileId && (
        <LinkPortalAccount tenantId={id} tenantEmail={tenantRow.email} />
      )}

      <Tabs tabs={tabs} defaultTab="overview" className="bg-white border border-slate-200 rounded-xl overflow-hidden" />
    </div>
  );
}
