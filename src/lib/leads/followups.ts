/**
 * lead_followups scheduling + the lead.followup job handler (Phase 6, item
 * E, blueprint §6). Follow-ups start after every successful live agent send
 * (never in shadow mode, never after a handoff) and are re-anchored on each
 * new agent reply — scheduleFollowupSequence() supersedes any still-scheduled
 * sequence for the lead. Stop conditions are re-checked at send time
 * (decideFollowup), which is the runtime source of truth per blueprint §0.10.
 */

import { db } from '@/lib/db';
import { agentJobs, crmLeads, leadFollowups, propertyVisits } from '@/lib/db/schema';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { getLead } from '@/lib/agent/lead';
import { getSessionById, appendSystemOutboundToHistory } from '@/lib/agent/session';
import { sendVisitMessage } from '@/lib/agent/visits/messaging';
import { ACTIVE_VISIT_STATUSES } from '@/lib/agent/visits/types';
import type { AgentLanguage } from '@/lib/agent/types';
import { getStage } from './stages';
import { decideFollowup, planFollowups } from './followup-plan';
import { LEAD_JOB_KINDS, parseFollowupPolicy, type FollowupStopReason, type Pipeline } from './types';

// Same query-builder surface as `db` (select/insert/update/execute).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * (Re)anchors the follow-up sequence for a lead: cancels any still-scheduled
 * rows ('superseded'), plans a fresh sequence from the org's follow-up
 * policy and inserts both the lead_followups rows and their agent_jobs
 * (tx-inserted, like visits/service.ts, so a crash between the two never
 * leaves an orphaned row). Returns the number of steps scheduled.
 */
export async function scheduleFollowupSequence(a: {
  orgId: string;
  leadId: string;
  sessionId: string;
  anchorAt: Date;
}): Promise<number> {
  const config = await getOrCreateAgentConfig(a.orgId);
  const policy = parseFollowupPolicy(config.followupPolicy);
  if (!policy.enabled) return 0;
  const plan = planFollowups(a.anchorAt, policy, config.timezone);
  if (plan.length === 0) return 0;

  return db.transaction(async (tx: Tx) => {
    await tx
      .update(leadFollowups)
      .set({ status: 'cancelled', stopReason: 'superseded' as FollowupStopReason, updatedAt: new Date() })
      .where(and(eq(leadFollowups.leadId, a.leadId), eq(leadFollowups.orgId, a.orgId), eq(leadFollowups.status, 'scheduled')));

    const inserted = await tx
      .insert(leadFollowups)
      .values(
        plan.map((p) => ({
          orgId: a.orgId,
          leadId: a.leadId,
          sessionId: a.sessionId,
          sequenceAnchorAt: a.anchorAt,
          step: p.step,
          kind: p.kind,
          templateName: p.template,
          scheduledFor: p.scheduledFor,
        })),
      )
      .onConflictDoNothing({ target: [leadFollowups.leadId, leadFollowups.sequenceAnchorAt, leadFollowups.step] })
      .returning({ id: leadFollowups.id, scheduledFor: leadFollowups.scheduledFor });

    if (inserted.length > 0) {
      await tx.insert(agentJobs).values(
        inserted.map((row) => ({
          orgId: a.orgId,
          kind: LEAD_JOB_KINDS.followup,
          runAt: row.scheduledFor,
          payload: { followupId: row.id },
        })),
      );

      const nextAt = inserted.reduce((min, r) => (r.scheduledFor < min ? r.scheduledFor : min), inserted[0].scheduledFor);
      await tx
        .update(crmLeads)
        .set({ followupState: 'active', followupStopReason: null, nextFollowupAt: nextAt, updatedAt: new Date() })
        .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)));
    }

    return inserted.length;
  });
}

/**
 * Cancels every still-scheduled follow-up for a lead and marks the lead's
 * sequence 'stopped'. Called from: the inbound path (reply), setSessionMode
 * (human takeover), moveLeadStage (won/lost) and setDoNotContact(true) — see
 * those call sites for the exact hook wiring.
 */
export async function stopFollowups(orgId: string, leadId: string, reason: FollowupStopReason): Promise<number> {
  const cancelled = await db
    .update(leadFollowups)
    .set({ status: 'cancelled', stopReason: reason, updatedAt: new Date() })
    .where(and(eq(leadFollowups.leadId, leadId), eq(leadFollowups.orgId, orgId), eq(leadFollowups.status, 'scheduled')))
    .returning({ id: leadFollowups.id });

  await db
    .update(crmLeads)
    .set({ followupState: 'stopped', followupStopReason: reason, nextFollowupAt: null, updatedAt: new Date() })
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)));

  return cancelled.length;
}

/** Deterministic, LLM-free copy per step — no per-lead personalization beyond the first name. */
const FOLLOWUP_TEXT: Record<number, Record<AgentLanguage, (name: string) => string>> = {
  1: {
    es: (n) => `Hola ${n}, ¿sigues interesado/a? Cuéntame si tienes alguna duda y seguimos viendo opciones.`,
    en: (n) => `Hi ${n}, still interested? Let me know if you have any questions and we'll keep looking at options.`,
    pt: (n) => `Olá ${n}, ainda tem interesse? Me avise se tiver alguma dúvida e seguimos vendo opções.`,
  },
  2: {
    es: (n) => `Hola ${n}, seguimos disponibles para ayudarte a encontrar tu propiedad ideal. ¿Seguimos en contacto?`,
    en: (n) => `Hi ${n}, we're still here to help you find your ideal property. Shall we keep in touch?`,
    pt: (n) => `Olá ${n}, seguimos disponíveis para te ajudar a encontrar seu imóvel ideal. Seguimos em contato?`,
  },
  3: {
    es: (n) => `Hola ${n}, ¿te gustaría retomar la búsqueda? Tenemos nuevas opciones que podrían interesarte.`,
    en: (n) => `Hi ${n}, would you like to pick the search back up? We have new options that might interest you.`,
    pt: (n) => `Olá ${n}, gostaria de retomar a busca? Temos novas opções que podem te interessar.`,
  },
};

/** Deterministic, ≤300 chars, no LLM call. Falls back to the step-1 copy for any step beyond the built-in set. */
export function buildFollowupText(step: number, lang: AgentLanguage, firstName: string | null): string {
  const name = firstName?.trim() || (lang === 'en' ? 'there' : lang === 'pt' ? 'tudo bem' : 'qué tal');
  const byStep = FOLLOWUP_TEXT[step] ?? FOLLOWUP_TEXT[1];
  return byStep[lang](name).slice(0, 300);
}

async function hasActiveVisit(orgId: string, leadId: string): Promise<boolean> {
  const rows = await db
    .select({ id: propertyVisits.id })
    .from(propertyVisits)
    .where(and(
      eq(propertyVisits.orgId, orgId),
      eq(propertyVisits.leadId, leadId),
      inArray(propertyVisits.status, [...ACTIVE_VISIT_STATUSES]),
    ))
    .limit(1);
  return rows.length > 0;
}

async function recomputeNextFollowupAt(orgId: string, leadId: string): Promise<void> {
  const rows = await db
    .select({ scheduledFor: leadFollowups.scheduledFor })
    .from(leadFollowups)
    .where(and(eq(leadFollowups.orgId, orgId), eq(leadFollowups.leadId, leadId), eq(leadFollowups.status, 'scheduled')))
    .orderBy(asc(leadFollowups.scheduledFor))
    .limit(1);

  await db
    .update(crmLeads)
    .set({ nextFollowupAt: rows[0]?.scheduledFor ?? null, updatedAt: new Date() })
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)));
}

const STALE_FOLLOWUP_HOURS = 24;

/**
 * Backstop for jobs.ts' own retry/backoff: registerAgentJobHandler() passes
 * no attempt count to the handler, so runFollowupJob can't tell "this was
 * the final attempt" — on send failure it just reverts to 'scheduled' and
 * lets agent_jobs retry. If agent_jobs eventually exhausts MAX_ATTEMPTS and
 * marks its own row 'failed', the lead_followups row is never touched again
 * and would stay 'scheduled' forever. Called once a day from the
 * lead-alerts cron route, this sweeps any row still 'scheduled' more than
 * 24h past its scheduledFor, marks it 'failed' and recomputes
 * crm_leads.next_followup_at for every affected lead.
 */
export async function sweepStaleFollowups(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_FOLLOWUP_HOURS * 60 * 60 * 1000);

  const stale = await db
    .update(leadFollowups)
    .set({ status: 'failed', stopReason: 'job_failed', updatedAt: now })
    .where(and(eq(leadFollowups.status, 'scheduled'), lt(leadFollowups.scheduledFor, cutoff)))
    .returning({ orgId: leadFollowups.orgId, leadId: leadFollowups.leadId });

  const seen = new Set<string>();
  for (const row of stale) {
    const key = `${row.orgId}:${row.leadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await recomputeNextFollowupAt(row.orgId, row.leadId);
  }

  return stale.length;
}

/**
 * Job handler for lead.followup (registered by register-jobs.ts). Claims the
 * row (status scheduled -> sending) so a retried/duplicate job is a no-op,
 * re-evaluates every stop condition at send time, then sends or skips.
 */
export async function runFollowupJob(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const followupId = payload.followupId as string | undefined;
  if (!followupId) return;

  const claimed = await db
    .update(leadFollowups)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(leadFollowups.id, followupId), eq(leadFollowups.orgId, orgId), eq(leadFollowups.status, 'scheduled')))
    .returning();
  const row = claimed[0];
  if (!row) return; // already handled (superseded/cancelled/retried) — no-op

  const now = new Date();
  const lead = await getLead(orgId, row.leadId);
  if (!lead) {
    await db.update(leadFollowups).set({ status: 'cancelled', stopReason: 'no_session', updatedAt: now }).where(eq(leadFollowups.id, row.id));
    return;
  }

  const stage = await getStage(orgId, lead.pipeline as Pipeline, lead.stage);
  const session = row.sessionId ? await getSessionById(orgId, row.sessionId) : null;
  const activeVisit = await hasActiveVisit(orgId, row.leadId);

  const config = await getOrCreateAgentConfig(orgId);
  const policy = parseFollowupPolicy(config.followupPolicy);

  if (config.shadowMode) {
    await db.update(leadFollowups).set({ status: 'cancelled', stopReason: 'shadow_mode', updatedAt: now }).where(eq(leadFollowups.id, row.id));
    await stopFollowups(orgId, row.leadId, 'shadow_mode');
    return;
  }

  const decision = decideFollowup({
    kind: row.kind as 'text' | 'template',
    anchorAt: row.sequenceAnchorAt,
    policyEnabled: policy.enabled,
    lead: { doNotContact: lead.doNotContact, phone: lead.phone, stageKind: stage?.kind ?? 'open' },
    session: session ? { mode: session.mode, lastInboundAt: session.lastInboundAt, windowExpiresAt: session.windowExpiresAt } : null,
    hasActiveVisit: activeVisit,
    now,
  });

  if (decision.action === 'stop') {
    await db.update(leadFollowups).set({ status: 'cancelled', stopReason: decision.reason, updatedAt: now }).where(eq(leadFollowups.id, row.id));
    await stopFollowups(orgId, row.leadId, decision.reason);
    return;
  }

  if (decision.action === 'skip') {
    await db.update(leadFollowups).set({ status: 'skipped', stopReason: decision.reason, updatedAt: now }).where(eq(leadFollowups.id, row.id));
    await recomputeNextFollowupAt(orgId, row.leadId);
    return;
  }

  const firstName = lead.fullName?.trim().split(/\s+/)[0] ?? null;
  const lang: AgentLanguage = session?.language ?? 'es';
  const bodyText = buildFollowupText(row.step, lang, firstName);

  const result = await sendVisitMessage({
    orgId,
    phone: lead.phone as string, // decideFollowup already stopped on no_phone
    bodyText,
    template: row.kind === 'template' && row.templateName ? { name: row.templateName, bodyParams: [firstName ?? ''] } : undefined,
    meta: { kind: 'lead_followup', followupId: row.id, step: row.step },
  });

  if (!result.success) {
    // Revert the claim so the job retries (agent_jobs' own retry/backoff).
    await db.update(leadFollowups).set({ status: 'scheduled', updatedAt: now }).where(eq(leadFollowups.id, row.id));
    throw new Error(`[leads/followups] send failed: ${result.error ?? 'unknown'}`);
  }

  await db.update(leadFollowups).set({ status: 'sent', sentAt: now, updatedAt: now }).where(eq(leadFollowups.id, row.id));

  if (row.sessionId) {
    await appendSystemOutboundToHistory({ orgId, sessionId: row.sessionId, text: bodyText }).catch((err) => {
      log.warn('[leads/followups] appendSystemOutboundToHistory failed', { orgId, err: (err as Error).message });
    });
  }

  const isLastStep = row.step >= policy.steps.length;
  if (isLastStep) {
    await db
      .update(crmLeads)
      .set({ followupState: 'completed', nextFollowupAt: null, updatedAt: now })
      .where(and(eq(crmLeads.id, row.leadId), eq(crmLeads.orgId, orgId)));
  } else {
    await recomputeNextFollowupAt(orgId, row.leadId);
  }
}
