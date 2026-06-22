import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  tenants,
  units,
  properties,
  incidents,
  tenantTasks,
  sanctions,
  payments as paymentsTable,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage';
import { getTranslations } from 'next-intl/server';
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
import type { ActivityEvent } from '@/lib/tenants/activity-feed';

export const metadata: Metadata = { title: 'Tenant Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');

  // Fetch tenant (app-layer org isolation — 404 if wrong org)
  const tenantRows = await db
    .select({
      id:          tenants.id,
      fullName:    tenants.fullName,
      email:       tenants.email,
      phone:       tenants.phone,
      photoUrl:    tenants.photoUrl,
      unitId:      tenants.unitId,
      profileId:   tenants.profileId,
      notes:       tenants.notes,
      preferredLanguage: tenants.preferredLanguage,
      documentNumber:    tenants.documentNumber,
      createdAt:         tenants.createdAt,
      unitLabel:    units.label,
      propertyName: properties.name,
    })
    .from(tenants)
    .leftJoin(units, and(eq(units.id, tenants.unitId), eq(units.orgId, ctx.orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
    .where(and(eq(tenants.id, id), eq(tenants.orgId, ctx.orgId)));

  if (!tenantRows.length) notFound();
  const tenant = tenantRows[0];

  // Eager fetches for Overview tab + activity feed
  const [
    statementResult,
    incidentRows,
    taskRows,
    sanctionRows,
    paymentRows,
    convRows,
  ] = await Promise.all([
    db.execute(sql`SELECT * FROM tenant_statement WHERE tenant_id = ${id}`),
    db
      .select({ id: incidents.id, title: incidents.title, status: incidents.status, createdAt: incidents.createdAt })
      .from(incidents)
      .where(and(eq(incidents.tenantId, id), eq(incidents.orgId, ctx.orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(50),
    db
      .select({ id: tenantTasks.id, title: tenantTasks.title, status: tenantTasks.status, createdAt: tenantTasks.createdAt })
      .from(tenantTasks)
      .where(and(eq(tenantTasks.tenantId, id), eq(tenantTasks.orgId, ctx.orgId)))
      .orderBy(desc(tenantTasks.createdAt))
      .limit(50),
    db
      .select({ id: sanctions.id, title: sanctions.title, kind: sanctions.kind, amount: sanctions.amount, status: sanctions.status, createdAt: sanctions.createdAt })
      .from(sanctions)
      .where(and(eq(sanctions.tenantId, id), eq(sanctions.orgId, ctx.orgId)))
      .orderBy(desc(sanctions.createdAt))
      .limit(50),
    db
      .select({ id: paymentsTable.id, amount: paymentsTable.amount, status: paymentsTable.status, createdAt: paymentsTable.createdAt })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, id), eq(paymentsTable.orgId, ctx.orgId)))
      .orderBy(desc(paymentsTable.paidAt))
      .limit(50),
    db
      .select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.tenantId, id), eq(whatsappConversations.orgId, ctx.orgId)))
      .limit(1),
  ]);

  const _stmtRaw     = ((statementResult as unknown as Array<{ balance: string; is_overdue: boolean; total_charges: string; total_approved_payments: string }>)?.[0] ?? null);
  const statement    = _stmtRaw ? {
    balance:                 Number(_stmtRaw.balance),
    is_overdue:              Boolean(_stmtRaw.is_overdue),
    total_charges:           Number(_stmtRaw.total_charges),
    total_approved_payments: Number(_stmtRaw.total_approved_payments),
  } : null;
  const incidentsArr = incidentRows;
  const tasksArr     = taskRows;
  const sanctionsArr = sanctionRows;
  const paymentsArr  = paymentRows;
  const conversation = convRows[0] ?? null;

  // WhatsApp last message (for OverviewTab)
  let waMessages: { id: string; direction: string; body: string | null; classification: string | null; status: string; createdAt: Date }[] = [];
  if (conversation) {
    waMessages = await db
      .select({
        id:             whatsappMessages.id,
        direction:      whatsappMessages.direction,
        body:           whatsappMessages.body,
        classification: whatsappMessages.classification,
        status:         whatsappMessages.status,
        createdAt:      whatsappMessages.createdAt,
      })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.conversationId, conversation.id), eq(whatsappMessages.orgId, ctx.orgId)))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);
  }

  // Signed URL for avatar (Tigris S3)
  let avatarSignedUrl: string | null = null;
  if (tenant.photoUrl) {
    try { avatarSignedUrl = await getSignedUrl('tenant-avatars', tenant.photoUrl, 3600); } catch { avatarSignedUrl = null; }
  }

  // Build activity feed inline (W6 TODO: migrate buildTenantActivityFeed lib to Drizzle)
  const FEED_LIMIT = 30;
  const activityEvents: ActivityEvent[] = [];
  for (const p of paymentsArr) {
    activityEvents.push({ id: p.id, type: 'payment', label: `Payment — ${p.status}`, status: p.status, createdAt: String(p.createdAt) });
  }
  for (const inc of incidentsArr) {
    activityEvents.push({ id: inc.id, type: 'incident', label: inc.title, status: inc.status, createdAt: String(inc.createdAt) });
  }
  for (const tk of tasksArr) {
    activityEvents.push({ id: tk.id, type: 'task', label: tk.title, status: tk.status, createdAt: String(tk.createdAt) });
  }
  for (const s of sanctionsArr) {
    activityEvents.push({ id: s.id, type: 'sanction', label: s.title, status: s.status, createdAt: String(s.createdAt) });
  }
  for (const m of waMessages) {
    activityEvents.push({ id: m.id, type: 'whatsapp', label: `WhatsApp — ${m.direction === 'inbound' ? 'Inbound' : 'Outbound'}`, detail: m.classification ?? undefined, status: m.status, createdAt: String(m.createdAt) });
  }
  activityEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const feedEvents = activityEvents.slice(0, FEED_LIMIT);

  // Derived counts
  const activeIncidentsCount = incidentsArr.filter((i) => ['open', 'in_progress'].includes(i.status)).length;
  const pendingTasksCount    = tasksArr.filter((tk) => tk.status === 'pending').length;
  const lastWaMessage        = waMessages.length > 0 ? waMessages[0] : null;

  // Shape for child components that still use legacy snake_case props
  const tenantForProps = {
    id:           tenant.id,
    full_name:    tenant.fullName,
    email:        tenant.email,
    phone:        tenant.phone,
    photo_url:    tenant.photoUrl,
    unit_id:      tenant.unitId,
    profile_id:   tenant.profileId,
    notes:        tenant.notes,
    preferred_language: tenant.preferredLanguage,
    units: tenant.unitLabel ? { label: tenant.unitLabel, properties: tenant.propertyName ? { name: tenant.propertyName } : null } : null,
  };
  const unitForProps = tenant.unitLabel
    ? { label: tenant.unitLabel, properties: tenant.propertyName ? { name: tenant.propertyName } : null }
    : null;

  const tabs = [
    {
      id: 'overview',
      label: t('tabs.overview'),
      content: (
        <OverviewTab
          statement={statement}
          activeContract={null}
          activeIncidentsCount={activeIncidentsCount}
          pendingTasksCount={pendingTasksCount}
          lastWhatsAppMessage={lastWaMessage ? {
            body: lastWaMessage.body,
            created_at: String(lastWaMessage.createdAt),
          } : null}
          tenantId={id}
        />
      ),
    },
    { id: 'payments', label: t('tabs.payments'), content: (<Suspense fallback={<TabFallback />}><PaymentsTab tenantId={id} /></Suspense>) },
    { id: 'contracts', label: t('tabs.contracts'), content: (<Suspense fallback={<TabFallback />}><ContractsTab tenantId={id} /></Suspense>) },
    { id: 'incidents', label: t('tabs.incidents'), badge: activeIncidentsCount, content: (<Suspense fallback={<TabFallback />}><IncidentsTab tenantId={id} /></Suspense>) },
    { id: 'tasks', label: t('tabs.tasks'), badge: pendingTasksCount, content: (<Suspense fallback={<TabFallback />}><TasksTab tenantId={id} /></Suspense>) },
    { id: 'whatsapp', label: t('tabs.whatsapp'), content: (<Suspense fallback={<TabFallback />}><WhatsAppTab tenantId={id} /></Suspense>) },
    { id: 'documents', label: t('tabs.documents'), content: (<Suspense fallback={<TabFallback />}><DocumentsTab tenantId={id} /></Suspense>) },
    { id: 'sanctions', label: t('tabs.sanctions'), content: (<Suspense fallback={<TabFallback />}><SanctionsTab tenantId={id} /></Suspense>) },
    { id: 'notes', label: t('tabs.notes'), content: (<Suspense fallback={<TabFallback />}><NotesTab tenantId={id} /></Suspense>) },
    { id: 'activity', label: t('tabs.activity'), content: <ActivityTab events={feedEvents} /> },
    {
      id: 'portal-preview',
      label: t('tabs.portalPreview'),
      content: (<Suspense fallback={<TabFallback />}><PortalPreviewTab tenant={tenantForProps as never} /></Suspense>),
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      <ProfileHeader
        tenant={tenantForProps as never}
        unit={unitForProps as never}
        statement={statement}
        avatarSignedUrl={avatarSignedUrl}
        orgId={ctx.orgId}
      />
      <QuickActions tenantId={id} />
      {!tenant.profileId && (
        <LinkPortalAccount tenantId={id} tenantEmail={tenant.email} />
      )}
      <Tabs tabs={tabs} defaultTab="overview" className="bg-white border border-slate-200 rounded-xl overflow-hidden" />
    </div>
  );
}
