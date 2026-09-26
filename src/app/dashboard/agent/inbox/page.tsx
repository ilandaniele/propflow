import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentSessions, whatsappConversations, crmLeads, agentSuggestions, whatsappMessages } from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { Badge } from '@/components/ui/Badge';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { LiveSettingsForm } from './_components/LiveSettingsForm';

export const metadata: Metadata = { title: 'Bandeja del agente' };

const MODE_BADGE_VARIANT = { ai: 'success', human: 'warning', paused: 'default' } as const;

export default async function AgentInboxPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('agentInbox');

  const [config, sessions] = await Promise.all([
    getOrCreateAgentConfig(ctx.orgId),
    db
      .select({
        id: agentSessions.id,
        mode: agentSessions.mode,
        handoffReason: agentSessions.handoffReason,
        lastInboundAt: agentSessions.lastInboundAt,
        conversationId: whatsappConversations.id,
        externalPhone: whatsappConversations.externalPhone,
        unreadCountAdmin: whatsappConversations.unreadCountAdmin,
        leadFullName: crmLeads.fullName,
      })
      .from(agentSessions)
      .leftJoin(whatsappConversations, eq(whatsappConversations.id, agentSessions.whatsappConversationId))
      .leftJoin(crmLeads, eq(crmLeads.id, agentSessions.leadId))
      .where(and(eq(agentSessions.orgId, ctx.orgId), eq(agentSessions.channel, 'whatsapp')))
      .orderBy(desc(agentSessions.lastInboundAt))
      .limit(50),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const conversationIds = sessions.map((s) => s.conversationId).filter((id): id is string => id != null);

  const [pendingSuggestionRows, pendingMessageRows] = await Promise.all([
    sessionIds.length
      ? db
          .select({ sessionId: agentSuggestions.sessionId })
          .from(agentSuggestions)
          .where(and(inArray(agentSuggestions.sessionId, sessionIds), eq(agentSuggestions.status, 'pending')))
      : Promise.resolve([]),
    conversationIds.length
      ? db
          .select({ conversationId: whatsappMessages.conversationId })
          .from(whatsappMessages)
          .where(and(inArray(whatsappMessages.conversationId, conversationIds), eq(whatsappMessages.agentStatus, 'pending')))
      : Promise.resolve([]),
  ]);

  const sessionsWithPendingSuggestion = new Set(pendingSuggestionRows.map((r) => r.sessionId));
  const conversationsWithPendingInbound = new Set(pendingMessageRows.map((r) => r.conversationId));

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
      </div>

      <LiveSettingsForm
        whatsappEnabled={config.channelsEnabled.whatsapp}
        shadowMode={config.shadowMode}
        maxAgentTurns={config.maxAgentTurns}
      />

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">{t('empty')}</div>
        ) : (
          sessions.map((s) => (
            <Link
              key={s.id}
              href={`/dashboard/agent/inbox/${s.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {s.leadFullName ?? s.externalPhone ?? t('unknownContact')}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={MODE_BADGE_VARIANT[s.mode as keyof typeof MODE_BADGE_VARIANT] ?? 'default'}>
                    {t(`mode.${s.mode}` as Parameters<typeof t>[0])}
                  </Badge>
                  {s.handoffReason && (
                    <span className="text-xs text-slate-400">
                      {t(`handoffReason.${s.handoffReason}` as Parameters<typeof t>[0])}
                    </span>
                  )}
                  {sessionsWithPendingSuggestion.has(s.id) && (
                    <span className="w-2 h-2 rounded-full bg-amber-500" title={t('pendingSuggestion')} />
                  )}
                  {s.conversationId && conversationsWithPendingInbound.has(s.conversationId) && (
                    <span className="w-2 h-2 rounded-full bg-red-500" title={t('unanswered')} />
                  )}
                </div>
                {s.lastInboundAt && (
                  <p className="text-xs text-slate-400 mt-1">{new Date(s.lastInboundAt).toLocaleString()}</p>
                )}
              </div>
              {s.unreadCountAdmin != null && s.unreadCountAdmin > 0 && <Badge variant="danger">{s.unreadCountAdmin}</Badge>}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
