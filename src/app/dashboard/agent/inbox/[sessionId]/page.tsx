import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { whatsappConversations, whatsappMessages, crmLeads } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getSessionById, isWindowOpen } from '@/lib/agent/session';
import { listSessionEvents } from '@/lib/agent/events';
import { getPendingSuggestion } from '@/lib/agent/suggestions';
import { MarkReadOnView } from '../../../whatsapp/_components/MarkReadOnView';
import { AutoRefresh } from '../_components/AutoRefresh';
import { ModeControls } from '../_components/ModeControls';
import { SuggestionCard } from '../_components/SuggestionCard';
import { ManualReplyForm } from '../_components/ManualReplyForm';
import { LeadPanel } from '../_components/LeadPanel';
import { EventTimeline, type TimelineItem } from '../_components/EventTimeline';

export const metadata: Metadata = { title: 'Bandeja del agente' };

export default async function AgentInboxSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('agentInbox');
  const { sessionId } = await params;

  // IDOR guard: session must belong to this org.
  const session = await getSessionById(ctx.orgId, sessionId);
  if (!session) notFound();

  const [conversation, lead, messages, events, pendingSuggestion] = await Promise.all([
    session.whatsappConversationId
      ? db
          .select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
          .from(whatsappConversations)
          .where(and(eq(whatsappConversations.id, session.whatsappConversationId), eq(whatsappConversations.orgId, ctx.orgId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    session.leadId
      ? db
          .select({
            fullName: crmLeads.fullName,
            phone: crmLeads.phone,
            stage: crmLeads.stage,
            score: crmLeads.score,
            intentTag: crmLeads.intentTag,
            zones: crmLeads.zones,
            budgetMin: crmLeads.budgetMin,
            budgetMax: crmLeads.budgetMax,
            currency: crmLeads.currency,
          })
          .from(crmLeads)
          .where(and(eq(crmLeads.id, session.leadId), eq(crmLeads.orgId, ctx.orgId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    session.whatsappConversationId
      ? db
          .select({
            id: whatsappMessages.id,
            direction: whatsappMessages.direction,
            senderKind: whatsappMessages.senderKind,
            body: whatsappMessages.body,
            attachmentKind: whatsappMessages.attachmentKind,
            createdAt: whatsappMessages.createdAt,
          })
          .from(whatsappMessages)
          .where(and(eq(whatsappMessages.conversationId, session.whatsappConversationId), eq(whatsappMessages.orgId, ctx.orgId)))
          .orderBy(asc(whatsappMessages.createdAt))
          .limit(200)
      : Promise.resolve([]),
    listSessionEvents(ctx.orgId, session.id, 100),
    getPendingSuggestion(ctx.orgId, session.id),
  ]);

  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({
      type: 'message' as const,
      id: m.id,
      createdAt: m.createdAt,
      direction: m.direction as 'inbound' | 'outbound',
      senderKind: m.senderKind,
      body: m.body,
      attachmentKind: m.attachmentKind,
    })),
    ...events.map((e) => ({
      type: 'event' as const,
      id: e.id,
      createdAt: e.createdAt,
      kind: e.kind,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const windowOpen = isWindowOpen(session);

  return (
    <div className="max-w-5xl space-y-4">
      {session.whatsappConversationId && <MarkReadOnView conversationId={session.whatsappConversationId} />}
      <AutoRefresh />

      <div className="flex items-center justify-between">
        <Link href="/dashboard/agent/inbox" className="text-sm text-brand-600 hover:text-brand-800">
          {t('backToInbox')}
        </Link>
        <ModeControls sessionId={session.id} mode={session.mode} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="text-sm text-slate-500">
              {lead?.fullName ?? t('unknownContact')}
              {conversation?.externalPhone && <span className="text-slate-400"> — {conversation.externalPhone}</span>}
            </div>

            <EventTimeline items={timeline} />

            {pendingSuggestion && <SuggestionCard suggestionId={pendingSuggestion.id} body={pendingSuggestion.body} />}

            <ManualReplyForm sessionId={session.id} windowOpen={windowOpen} />
          </div>
        </div>

        <div>
          <LeadPanel
            fullName={lead?.fullName ?? null}
            phone={lead?.phone ?? conversation?.externalPhone ?? null}
            stage={lead?.stage ?? null}
            score={lead?.score ?? null}
            intentTag={lead?.intentTag ?? null}
            zones={(lead?.zones as string[] | undefined) ?? []}
            budgetMin={lead?.budgetMin ?? null}
            budgetMax={lead?.budgetMax ?? null}
            currency={lead?.currency ?? null}
            attribution={session.attribution}
            language={session.language}
          />
        </div>
      </div>
    </div>
  );
}
