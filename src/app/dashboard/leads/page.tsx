import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentSessions, crmLeads, profiles } from '@/lib/db/schema';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { getPipelineStages } from '@/lib/leads/stages';
import { listRoutingMembers } from '@/lib/leads/routing';
import { parseFollowupPolicy, type Pipeline } from '@/lib/leads/types';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { CreateLeadForm } from './CreateLeadForm';
import { LeadsKanban, OTHER_STAGE_KEY, type LeadCardData } from './LeadsKanban';
import { StageSettingsDialogLauncher } from './StageSettingsDialog';
import { LeadSettingsCard } from './LeadSettingsCard';

export const metadata: Metadata = { title: 'Leads' };

// Card list is capped per stage (blueprint §7 — "cards are capped at 100 per
// stage by updated_at desc, with a '+N más' label"). Per-stage *counts* come
// from a separate un-capped GROUP BY query (the KPI-bug lesson: dashboard
// totals must never be computed over a .limit()-ed row set).
const CARDS_FETCH_LIMIT = 1000;
const CARDS_PER_STAGE_CAP = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeadsSearchParams {
  pipeline?: string;
  advisor?: string;
  q?: string;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<LeadsSearchParams>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const params = await searchParams;
  const t = await getTranslations('leadsPipeline');
  // Deliberately not a second getTranslations() call here — tests/unit/i18n's
  // coverage check cross-validates every t() key against every namespace
  // used anywhere in the file, so mixing 'leadsPipeline' and 'leads' would
  // false-positive on keys that only exist in one of them.

  const pipeline: Pipeline = params.pipeline === 'supply' ? 'supply' : 'demand';
  const rawAdvisor = params.advisor ?? 'all';
  const advisorParam = rawAdvisor === 'all' || rawAdvisor === 'unassigned' || UUID_RE.test(rawAdvisor) ? rawAdvisor : 'all';
  const q = (params.q ?? '').trim().slice(0, 80);

  const filters = [eq(crmLeads.orgId, ctx.orgId), eq(crmLeads.pipeline, pipeline)];
  if (advisorParam === 'unassigned') filters.push(isNull(crmLeads.assignedProfileId));
  else if (advisorParam !== 'all') filters.push(eq(crmLeads.assignedProfileId, advisorParam));
  if (q) filters.push(or(ilike(crmLeads.fullName, `%${q}%`), ilike(crmLeads.phone, `%${q}%`))!);
  const where = and(...filters);

  const [stages, counts, cardRows, advisors, config] = await Promise.all([
    getPipelineStages(ctx.orgId, pipeline),
    db.select({ stage: crmLeads.stage, count: sql<number>`count(*)::int` })
      .from(crmLeads)
      .where(where)
      .groupBy(crmLeads.stage),
    db.select({
      id: crmLeads.id,
      fullName: crmLeads.fullName,
      stage: crmLeads.stage,
      score: crmLeads.score,
      intentTag: crmLeads.intentTag,
      assignedProfileId: crmLeads.assignedProfileId,
      nextFollowupAt: crmLeads.nextFollowupAt,
      followupState: crmLeads.followupState,
      source: crmLeads.source,
      sourceChannel: crmLeads.sourceChannel,
      doNotContact: crmLeads.doNotContact,
      updatedAt: crmLeads.updatedAt,
    })
      .from(crmLeads)
      .where(where)
      .orderBy(desc(crmLeads.updatedAt))
      .limit(CARDS_FETCH_LIMIT),
    db.select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.orgId, ctx.orgId), eq(profiles.role, 'admin'))),
    getOrCreateAgentConfig(ctx.orgId),
  ]);

  const leadIds = cardRows.map((r) => r.id);
  const sessionRows = leadIds.length === 0 ? [] : await db
    .select({ id: agentSessions.id, leadId: agentSessions.leadId })
    .from(agentSessions)
    .where(and(eq(agentSessions.orgId, ctx.orgId), inArray(agentSessions.leadId, leadIds)))
    .orderBy(desc(agentSessions.updatedAt));
  const sessionByLead = new Map<string, string>();
  for (const s of sessionRows) if (s.leadId && !sessionByLead.has(s.leadId)) sessionByLead.set(s.leadId, s.id);

  const advisorNameById = new Map(advisors.map((a) => [a.id, a.fullName ?? a.id]));
  const activeStageKeys = new Set(stages.map((s) => s.key));

  const byStage = new Map<string, LeadCardData[]>();
  for (const s of stages) byStage.set(s.key, []);
  byStage.set(OTHER_STAGE_KEY, []);

  for (const row of cardRows) {
    const key = activeStageKeys.has(row.stage) ? row.stage : OTHER_STAGE_KEY;
    const list = byStage.get(key)!;
    if (list.length < CARDS_PER_STAGE_CAP) {
      list.push({
        id: row.id,
        fullName: row.fullName,
        stage: row.stage,
        score: row.score,
        intentTag: row.intentTag,
        assignedProfileId: row.assignedProfileId,
        advisorName: row.assignedProfileId ? (advisorNameById.get(row.assignedProfileId) ?? null) : null,
        nextFollowupAt: row.nextFollowupAt ? row.nextFollowupAt.toISOString() : null,
        followupState: row.followupState,
        source: row.source,
        sourceChannel: row.sourceChannel,
        doNotContact: row.doNotContact,
        sessionId: sessionByLead.get(row.id) ?? null,
      });
    }
  }

  const countByStage = new Map<string, number>();
  for (const c of counts) countByStage.set(c.stage, c.count);
  const otherCount = [...countByStage.entries()].reduce((sum, [key, n]) => (activeStageKeys.has(key) ? sum : sum + n), 0);

  const columns = [
    ...stages.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      kind: s.kind,
      count: countByStage.get(s.key) ?? 0,
      leads: byStage.get(s.key) ?? [],
    })),
    {
      key: OTHER_STAGE_KEY,
      label: 'Otros', // synthetic column for unknown/archived stage keys — not a real stage, no i18n key reserved for it
      color: null,
      kind: 'open' as const,
      count: otherCount,
      leads: byStage.get(OTHER_STAGE_KEY) ?? [],
    },
  ].filter((c) => c.key !== OTHER_STAGE_KEY || c.count > 0);

  const routingMembers = await listRoutingMembers(ctx.orgId);
  const followupPolicy = parseFollowupPolicy(config.followupPolicy);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <div className="flex gap-2">
          <a
            href={`/dashboard/leads?pipeline=demand`}
            className={`px-3 py-1.5 text-sm rounded-md border ${pipeline === 'demand' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200'}`}
          >
            {t('demand')}
          </a>
          <a
            href={`/dashboard/leads?pipeline=supply`}
            className={`px-3 py-1.5 text-sm rounded-md border ${pipeline === 'supply' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200'}`}
          >
            {t('supply')}
          </a>
        </div>
      </div>

      <details className="bg-white border border-slate-200 rounded-xl p-4">
        <summary className="text-sm font-medium text-slate-800 cursor-pointer">Nuevo lead</summary>
        <div className="mt-3">
          <CreateLeadForm />
        </div>
      </details>

      <LeadsKanban
        pipeline={pipeline}
        columns={columns}
        advisors={advisors.map((a) => ({ id: a.id, fullName: a.fullName ?? a.id }))}
        selectedAdvisor={advisorParam}
        q={q}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageSettingsDialogLauncher pipeline={pipeline} stages={stages} />
        <LeadSettingsCard
          routingMode={config.routingMode}
          members={routingMembers}
          advisors={advisors.map((a) => ({ id: a.id, fullName: a.fullName ?? a.id }))}
          followupsEnabled={followupPolicy.enabled}
          listingAlertsEnabled={followupPolicy.listingAlerts.enabled}
        />
      </div>
    </div>
  );
}
