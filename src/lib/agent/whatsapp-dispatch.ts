/**
 * WhatsApp live pipeline: webhook → debounced agent_jobs turn → send (or
 * shadow-mode suggestion). See handoffs/phase2-blueprint.md section 4.
 */

import { after } from 'next/server';
import { db } from '@/lib/db';
import { agentJobs, listings } from '@/lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from './config';
import {
  getOrCreateSession,
  getSessionByConversation,
  getSessionById,
  touchInbound,
  tryAcquireSessionLock,
  releaseSessionLock,
  setSessionAttributionIfEmpty,
  setAssistantMessageSendStatus,
} from './session';
import { getLead } from './lead';
import { recordAgentEvent } from './events';
import { enqueueJob } from './jobs';
import { runAgentTurn } from './run-turn';
import { createSuggestion } from './suggestions';
import { sendWhatsAppText } from './outbound';
import { parseCtwaReferral, extractRefCode } from '@/lib/whatsapp/referral';
import {
  claimPendingInbound,
  finishClaimedInbound,
  hasPendingInbound,
  listStalePendingConversations,
  listHumanRepliesSince,
} from '@/lib/whatsapp/db';
import type { AgentAttribution } from './types';

export const AGENT_WHATSAPP_TURN_JOB = 'agent.whatsapp_turn';
export const AGENT_DEBOUNCE_MS = 4000;

const ATTACHMENT_PLACEHOLDERS: Record<string, string> = {
  image: '[imagen]',
  document: '[documento]',
  audio: '[audio]',
  video: '[video]',
};

export interface QueueAgentInboundArgs {
  orgId: string;
  conversationId: string;
  externalPhone: string;
  text: string | null;
  referral: Record<string, unknown> | null;
}

/** Resolves a `ref` code from prefilled wa.me text against this org's listings. Null if not found. */
async function resolveRefCodeListing(orgId: string, refCode: string): Promise<string | null> {
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.orgId, orgId), eq(listings.refCode, refCode)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Loads/creates the agent session for this inbound message, touches the 24h
 * window, records attribution once, and enqueues the debounced turn job.
 * Returns true if a job was enqueued.
 */
export async function queueAgentInbound(args: QueueAgentInboundArgs): Promise<boolean> {
  const session = await getOrCreateSession({
    orgId: args.orgId,
    channel: 'whatsapp',
    externalId: args.externalPhone,
    whatsappConversationId: args.conversationId,
  });

  await touchInbound(session.id);

  const ctwa = parseCtwaReferral(args.referral);
  let attribution: Omit<AgentAttribution, 'capturedAt'> | null = ctwa;

  if (!attribution) {
    const refCode = extractRefCode(args.text);
    if (refCode) {
      const listingId = await resolveRefCodeListing(args.orgId, refCode);
      attribution = { type: 'wa_link', refCode, listingId };
    }
  }

  if (attribution) {
    const wrote = await setSessionAttributionIfEmpty(session.id, {
      ...attribution,
      capturedAt: new Date().toISOString(),
    });
    if (wrote) {
      await recordAgentEvent({ orgId: args.orgId, sessionId: session.id, kind: 'attribution', data: attribution });
    }
  }

  await enqueueJob({
    orgId: args.orgId,
    kind: AGENT_WHATSAPP_TURN_JOB,
    // Item 1: externalPhone is intentionally NOT carried in the job payload —
    // processWhatsAppAgentTurn re-derives it from the loaded session
    // (session.externalId), which is deterministic. A sweeper-enqueued job
    // (below) has no real phone to put here anyway.
    payload: { conversationId: args.conversationId },
    runAt: new Date(Date.now() + AGENT_DEBOUNCE_MS),
  });

  return true;
}

/** Builds the joined inbound text for a turn from claimed messages. */
function buildInboundText(
  claimed: Array<{ body: string | null; attachmentKind: string | null }>
): string {
  return claimed
    .map((m) => m.body ?? (m.attachmentKind ? ATTACHMENT_PLACEHOLDERS[m.attachmentKind] ?? `[${m.attachmentKind}]` : ''))
    .filter((t) => t.length > 0)
    .join('\n');
}

export interface WhatsAppAgentTurnPayload {
  conversationId: string;
  /**
   * Item 1: deprecated and unused — kept optional so an old job payload still
   * enqueued with it (pre-fix) deserializes harmlessly. The turn always
   * re-derives the real external id from the loaded session instead.
   */
  externalPhone?: string;
}

/**
 * The debounced turn: claims every pending message for the conversation,
 * gates, runs the agent, sends or shadows the reply. Safe to call
 * concurrently — the session lock (session.ts) serializes turns per session.
 */
export async function processWhatsAppAgentTurn(payload: WhatsAppAgentTurnPayload, orgId: string): Promise<void> {
  const session = await getSessionByConversation(orgId, payload.conversationId);
  if (!session) return;

  if (!(await tryAcquireSessionLock(session.id))) return;

  let claimedIds: string[] = [];
  try {
    const claimed = await claimPendingInbound(orgId, payload.conversationId);
    if (claimed.length === 0) return;
    claimedIds = claimed.map((m) => m.id);

    const config = await getOrCreateAgentConfig(orgId);
    const lead = session.leadId ? await getLead(orgId, session.leadId) : null;

    // Gating (decision 5): whatsapp channel enabled, lead not do_not_contact, session in 'ai' mode.
    const gated = !config.channelsEnabled.whatsapp || lead?.doNotContact === true || session.mode !== 'ai';
    if (gated) {
      await finishClaimedInbound(claimedIds, 'skipped');
      return;
    }

    const inboundText = buildInboundText(claimed);
    const humanRepliesSinceLastTurn = await listHumanRepliesSince(orgId, payload.conversationId, session.lastAgentTurnAt);

    const result = await runAgentTurn({
      orgId,
      channel: 'whatsapp',
      // Item 1: the session's own externalId, not the job payload's
      // (possibly-absent, possibly-stale) externalPhone.
      externalId: session.externalId,
      whatsappConversationId: payload.conversationId,
      inboundText,
      humanRepliesSinceLastTurn,
    });

    if (result.skipped) {
      await finishClaimedInbound(claimedIds, 'skipped');
      return;
    }

    // Item 2: the turn can take several model iterations; re-check the
    // session's mode now in case it was handed off to a human (or paused)
    // while the turn was running. A reply drafted for an AI-owned
    // conversation must never reach a contact once a human has taken over.
    const freshSession = await getSessionById(orgId, session.id);
    if (freshSession && freshSession.mode !== 'ai') {
      if (result.assistantMessageId) {
        await setAssistantMessageSendStatus(result.assistantMessageId, 'shadow_discarded');
      }
      await recordAgentEvent({ orgId, sessionId: session.id, kind: 'reply_dropped', data: { reason: 'mode_changed_mid_turn' } });
      await finishClaimedInbound(claimedIds, 'processed');
      return;
    }

    if (config.shadowMode) {
      await createSuggestion({
        orgId,
        sessionId: session.id,
        conversationId: payload.conversationId,
        body: result.replyText,
        agentMessageId: result.assistantMessageId,
      });
      await recordAgentEvent({ orgId, sessionId: session.id, kind: 'suggestion_created', data: {} });
    } else {
      const outcome = await sendWhatsAppText({
        orgId,
        conversationId: payload.conversationId,
        body: result.replyText,
        senderKind: 'agent',
      });
      if (!outcome.ok && outcome.code === 'WINDOW_CLOSED') {
        await recordAgentEvent({ orgId, sessionId: session.id, kind: 'window_closed', data: {} });
      }
    }

    await finishClaimedInbound(claimedIds, 'processed');
  } catch (err) {
    if (claimedIds.length > 0) await finishClaimedInbound(claimedIds, 'pending');
    await recordAgentEvent({
      orgId,
      sessionId: session.id,
      kind: 'turn_error',
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err; // let the job queue retry
  } finally {
    // Release the lock FIRST, then re-check for pending messages — this
    // ordering guarantees no message queued mid-turn is ever orphaned
    // (decision 3).
    await releaseSessionLock(session.id);
    if (await hasPendingInbound(orgId, payload.conversationId)) {
      await enqueueJob({
        orgId,
        kind: AGENT_WHATSAPP_TURN_JOB,
        payload: { conversationId: payload.conversationId },
        runAt: new Date(),
      });
    }
  }
}

const STALE_OLDER_THAN_MS = 2 * 60 * 1000; // the debounce job should have claimed it by now
const STALE_NEWER_THAN_MS = 30 * 60 * 1000; // not worth resurrecting past this
const STALE_SWEEP_LIMIT = 20;

/**
 * Backstop for messages whose debounce job was lost (crash, deploy). Skips
 * conversations that already have a pending/processing job queued.
 */
export async function sweepStalePendingInbound(): Promise<number> {
  const stale = await listStalePendingConversations(STALE_OLDER_THAN_MS, STALE_NEWER_THAN_MS, STALE_SWEEP_LIMIT);
  if (stale.length === 0) return 0;

  // Small inline query (blueprint 4 "Sweeper"): avoid double-enqueueing a
  // conversation whose debounce job is still pending/processing.
  const alreadyQueued = await db
    .select({ conversationId: sql<string>`${agentJobs.payload}->>'conversationId'` })
    .from(agentJobs)
    .where(and(
      eq(agentJobs.kind, AGENT_WHATSAPP_TURN_JOB),
      inArray(agentJobs.status, ['pending', 'processing']),
    ));
  const queuedSet = new Set(alreadyQueued.map((r) => r.conversationId));

  let enqueued = 0;
  for (const { orgId, conversationId } of stale) {
    if (queuedSet.has(conversationId)) continue;
    // Item 1: no externalPhone in the payload — the handler re-derives it
    // from the loaded session (session.externalId). A placeholder value here
    // used to create a bogus duplicate session/lead keyed on '' when the real
    // session lookup missed for any reason; omitting it entirely removes that
    // failure mode.
    await enqueueJob({ orgId, kind: AGENT_WHATSAPP_TURN_JOB, payload: { conversationId } });
    enqueued++;
  }
  return enqueued;
}

/**
 * after()-wraps the debounce sleep + drain so the webhook route can respond
 * immediately. `after()` throws outside a request scope (e.g. called from a
 * background sweep or a test), so this falls back to a fire-and-forget
 * promise there — see AGENTS.md / node_modules/next/dist/docs/.../after.md.
 */
export function scheduleAgentDrain(): void {
  const run = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, AGENT_DEBOUNCE_MS));
    const { drainAgentJobs } = await import('./jobs');
    await drainAgentJobs(5).catch((e) => {
      log.error('[agent/whatsapp-dispatch] scheduled drain failed', {
        error: e instanceof Error ? e.message : 'unknown',
      });
    });
  };

  try {
    after(run);
  } catch {
    void run();
  }
}
