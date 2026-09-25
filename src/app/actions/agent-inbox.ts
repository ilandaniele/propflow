'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, err, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { getSessionById, setSessionMode, resetTurnCount } from '@/lib/agent/session';
import { recordAgentEvent } from '@/lib/agent/events';
import { sendWhatsAppText } from '@/lib/agent/outbound';
import { approveSuggestion, discardSuggestion } from '@/lib/agent/suggestions';
import { updateAgentLiveSettings } from '@/lib/agent/config';
import { enqueueJob } from '@/lib/agent/jobs';
import { hasPendingInbound } from '@/lib/whatsapp/db';
import type { ActionResult } from '@/lib/errors';
import { AGENT_WHATSAPP_TURN_JOB } from '@/lib/agent/whatsapp-dispatch';

const WINDOW_CLOSED_MESSAGE = 'Fuera de la ventana de 24 h: solo plantillas aprobadas';

const SessionIdSchema = z.object({ session_id: z.string().uuid() });
const ReplySchema = z.object({ session_id: z.string().uuid(), body: z.string().min(1).max(4096) });
const SuggestionIdSchema = z.object({ suggestion_id: z.string().uuid() });
const ApproveSuggestionSchema = z.object({
  suggestion_id: z.string().uuid(),
  body: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).max(4096).optional()),
});
const LiveSettingsSchema = z.object({
  whatsapp_enabled: z.enum(['true', 'false']),
  shadow_mode: z.enum(['true', 'false']),
  max_agent_turns: z.string().optional(),
});

/** IA → Humano: an admin takes over the conversation. */
export async function takeOverSession(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_take_over');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SessionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // IDOR guard: session must belong to this org.
  const session = await getSessionById(ctx.orgId, parsed.data.session_id);
  if (!session) return Errors.NOT_FOUND();

  await setSessionMode(session.id, 'human', undefined, 'manual');
  await recordAgentEvent({
    orgId: ctx.orgId,
    sessionId: session.id,
    kind: 'mode_change',
    data: { to: 'human' },
    actorProfileId: ctx.userId,
  });

  log.adminAction(ctx.userId, 'agent_inbox_take_over', 'agent_session', session.id);
  revalidatePath(`/dashboard/agent/inbox/${session.id}`);
  revalidatePath('/dashboard/agent/inbox');
  return ok(undefined);
}

/** Humano → IA. Resets the turn cap and, if messages are still waiting, re-enqueues a turn. */
export async function returnSessionToAi(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_return_to_ai');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SessionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const session = await getSessionById(ctx.orgId, parsed.data.session_id);
  if (!session) return Errors.NOT_FOUND();

  await setSessionMode(session.id, 'ai');
  await resetTurnCount(session.id);
  await recordAgentEvent({
    orgId: ctx.orgId,
    sessionId: session.id,
    kind: 'mode_change',
    data: { to: 'ai' },
    actorProfileId: ctx.userId,
  });

  if (session.whatsappConversationId) {
    const pending = await hasPendingInbound(ctx.orgId, session.whatsappConversationId);
    if (pending) {
      await enqueueJob({
        orgId: ctx.orgId,
        kind: AGENT_WHATSAPP_TURN_JOB,
        payload: { conversationId: session.whatsappConversationId, externalPhone: session.externalId },
        runAt: new Date(),
      });
    }
  }

  log.adminAction(ctx.userId, 'agent_inbox_return_to_ai', 'agent_session', session.id);
  revalidatePath(`/dashboard/agent/inbox/${session.id}`);
  revalidatePath('/dashboard/agent/inbox');
  return ok(undefined);
}

/** A human advisor replies from the inbox. Implicitly takes over an 'ai' session first. */
export async function sendAgentInboxReply(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_reply');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ReplySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const session = await getSessionById(ctx.orgId, parsed.data.session_id);
  if (!session) return Errors.NOT_FOUND();
  if (!session.whatsappConversationId) return Errors.NOT_FOUND();

  if (session.mode === 'ai') {
    // A human is typing in the inbox — stop the bot from talking over them.
    await setSessionMode(session.id, 'human', undefined, 'manual');
    await recordAgentEvent({
      orgId: ctx.orgId,
      sessionId: session.id,
      kind: 'mode_change',
      data: { to: 'human', implicit: true },
      actorProfileId: ctx.userId,
    });
  }

  const outcome = await sendWhatsAppText({
    orgId: ctx.orgId,
    conversationId: session.whatsappConversationId,
    body: parsed.data.body,
    senderKind: 'human',
    sentByProfileId: ctx.userId,
  });

  if (!outcome.ok) {
    if (outcome.code === 'WINDOW_CLOSED') return err('WINDOW_CLOSED', WINDOW_CLOSED_MESSAGE);
    if (outcome.code === 'NOT_FOUND') return Errors.NOT_FOUND();
    log.error('[agent-inbox] sendAgentInboxReply failed', { orgId: ctx.orgId, code: outcome.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_inbox_reply', 'agent_session', session.id);
  revalidatePath(`/dashboard/agent/inbox/${session.id}`);
  return ok(undefined);
}

/** Approves a pending shadow-mode suggestion (optionally edited) and sends it. */
export async function approveAgentSuggestion(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_approve');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ApproveSuggestionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const outcome = await approveSuggestion({
    orgId: ctx.orgId,
    suggestionId: parsed.data.suggestion_id,
    profileId: ctx.userId,
    editedBody: parsed.data.body,
  });

  if (!outcome.ok) {
    if (outcome.code === 'WINDOW_CLOSED') return err('WINDOW_CLOSED', WINDOW_CLOSED_MESSAGE);
    if (outcome.code === 'NOT_FOUND') return Errors.NOT_FOUND();
    log.error('[agent-inbox] approveAgentSuggestion failed', { orgId: ctx.orgId, code: outcome.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_inbox_approve_suggestion', 'agent_suggestion', parsed.data.suggestion_id);
  revalidatePath('/dashboard/agent/inbox');
  return ok(undefined);
}

/** Discards a pending shadow-mode suggestion without sending it. */
export async function discardAgentSuggestion(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_discard');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SuggestionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await discardSuggestion({ orgId: ctx.orgId, suggestionId: parsed.data.suggestion_id, profileId: ctx.userId });

  log.adminAction(ctx.userId, 'agent_inbox_discard_suggestion', 'agent_suggestion', parsed.data.suggestion_id);
  revalidatePath('/dashboard/agent/inbox');
  return ok(undefined);
}

/** Updates the "go live" settings from LiveSettingsForm (whatsapp on/off, shadow mode, turn cap). */
export async function updateAgentLiveSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_inbox_live_settings');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = LiveSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const raw = parsed.data.max_agent_turns;
  let maxAgentTurns: number | null;
  if (raw === undefined || raw === '') {
    maxAgentTurns = null;
  } else {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      return Errors.VALIDATION_ERROR({ formErrors: ['max_agent_turns must be an integer between 1 and 200'], fieldErrors: {} });
    }
    maxAgentTurns = n;
  }

  try {
    await updateAgentLiveSettings(ctx.orgId, {
      whatsappEnabled: parsed.data.whatsapp_enabled === 'true',
      shadowMode: parsed.data.shadow_mode === 'true',
      maxAgentTurns,
    });
  } catch (e) {
    log.error('[agent-inbox] updateAgentLiveSettingsAction failed', { orgId: ctx.orgId, err: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_inbox_live_settings', 'agent_config', ctx.orgId);
  revalidatePath('/dashboard/agent/inbox');
  return ok(undefined);
}
