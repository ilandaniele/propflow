/**
 * Resolves WhatsApp button/list quick-replies for the visit-scheduling flow
 * (reminders + post-visit) and hands them to the org's advisor / lead
 * directly — the agent turn is never involved unless a result carries
 * `agentFollowupText` (see `registerVisitButtonReplyHandler` below).
 *
 * Grammar (blueprint §5.4):
 *  - `visit:<uuid>:(confirm|resched|cancel|went|missed|fb_yes|fb_no|fb_more)`
 *  - `vslot:<uuid>:<slotId>`
 *  - Template quick-reply text (no payload): "Confirmo" | "Reprogramar" |
 *    "Sí, fui" | "No pude ir", matched case/accent-insensitively and
 *    resolved via `findNextActiveVisitByPhone`.
 *
 * Security: a visit only ever answers to the phone that owns it
 * (`visit.contactPhone === ctx.fromPhone`) — anything else responds
 * `not_found`, never `forbidden` (no information leak).
 */

import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { notificationInbox } from '@/lib/db/schema';
import { registerButtonReplyHandler, type ButtonReplyContext } from '../button-replies';
import { queueAgentInbound } from '../whatsapp-dispatch';
import { insertMessage } from '@/lib/whatsapp/db';
import { getOrCreateAgentConfig } from '../config';
import { getOrCreateSession } from '../session';
import { sendVisitMessage } from './messaging';
import { formatSlotLabel } from './slots';
import { decodeSlotId } from './slot-id';
import { buildReofferList, sendFeedbackRequest, sendReoffer } from './reminder-jobs';
import {
  cancelVisit,
  confirmVisit,
  findNextActiveVisitByPhone,
  getVisit,
  markVisitOutcome,
  recordVisitFeedback,
  rescheduleVisit,
} from './service';
import type { VisitRecord } from './types';

export interface VisitButtonReplyCtx {
  orgId: string;
  /** E.164 with a leading '+' — PII, never logged. */
  fromPhone: string;
  replyId: string;
  replyTitle: string | null;
  whatsappConversationId: string | null;
}

export type VisitButtonReplyAction =
  | 'confirmed'
  | 'reschedule_offered'
  | 'rescheduled'
  | 'cancelled'
  | 'outcome_recorded'
  | 'feedback_recorded'
  | 'not_found'
  | 'slot_taken';

export type VisitButtonReplyResult =
  | { handled: false }
  | { handled: true; action: VisitButtonReplyAction; agentFollowupText?: string };

type DirectAction = 'confirm' | 'resched' | 'cancel' | 'went' | 'missed' | 'fb_yes' | 'fb_no' | 'fb_more';
const DIRECT_ACTIONS: readonly DirectAction[] = ['confirm', 'resched', 'cancel', 'went', 'missed', 'fb_yes', 'fb_no', 'fb_more'];

type ParsedReply =
  | { kind: 'visit'; visitId: string; action: DirectAction }
  | { kind: 'vslot'; visitId: string; slotId: string };

function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const TEMPLATE_TEXT_MAP: Record<string, DirectAction> = {
  confirmo: 'confirm',
  reprogramar: 'resched',
  'si, fui': 'went',
  'no pude ir': 'missed',
};

function isDirectAction(v: string): v is DirectAction {
  return (DIRECT_ACTIONS as readonly string[]).includes(v);
}

function parseGrammar(replyId: string): ParsedReply | null {
  if (replyId.startsWith('vslot:')) {
    const idx1 = replyId.indexOf(':', 'vslot:'.length);
    if (idx1 < 0) return null;
    const visitId = replyId.slice('vslot:'.length, idx1);
    const slotId = replyId.slice(idx1 + 1);
    if (!visitId || !slotId) return null;
    return { kind: 'vslot', visitId, slotId };
  }
  if (replyId.startsWith('visit:')) {
    const parts = replyId.split(':');
    if (parts.length !== 3) return null;
    const [, visitId, action] = parts;
    if (!visitId || !isDirectAction(action)) return null;
    return { kind: 'visit', visitId, action };
  }
  return null;
}

/** Pure — 'visit:' / 'vslot:' ids, or a known template quick-reply text. */
export function isVisitButtonReply(replyId: string): boolean {
  if (replyId.startsWith('visit:') || replyId.startsWith('vslot:')) return true;
  return normalizeText(replyId) in TEMPLATE_TEXT_MAP;
}

async function ack(orgId: string, phone: string, bodyText: string, meta: Record<string, unknown>): Promise<void> {
  await sendVisitMessage({ orgId, phone, bodyText, meta });
}

async function runDirectAction(ctx: VisitButtonReplyCtx, visit: VisitRecord, action: DirectAction): Promise<VisitButtonReplyResult> {
  const config = await getOrCreateAgentConfig(ctx.orgId);

  switch (action) {
    case 'confirm': {
      const updated = await confirmVisit(ctx.orgId, visit.id);
      if (!updated) return { handled: true, action: 'not_found' };
      await ack(ctx.orgId, ctx.fromPhone, `¡Listo, te esperamos el ${formatSlotLabel(updated.startsAt, config.timezone)}!`, {
        kind: 'visit_button_confirm', visitId: visit.id,
      });
      return { handled: true, action: 'confirmed' };
    }

    case 'resched': {
      const list = await buildReofferList(ctx.orgId, visit);
      const title = visit.listingTitle ?? 'la propiedad';
      const bodyText = list ? `Elige un nuevo horario para tu visita a ${title}:` : `No encontramos horarios disponibles ahora mismo para ${title}; escríbenos y te ayudamos a coordinar.`;
      await sendVisitMessage({ orgId: ctx.orgId, phone: ctx.fromPhone, bodyText, list: list ?? undefined, meta: { kind: 'visit_reschedule_offer', visitId: visit.id } });
      return { handled: true, action: 'reschedule_offered' };
    }

    case 'cancel': {
      const result = await cancelVisit({ orgId: ctx.orgId, visitId: visit.id, leadId: visit.leadId, actor: 'lead_button' });
      if (!result.ok) return { handled: true, action: 'not_found' };
      await ack(ctx.orgId, ctx.fromPhone, 'Listo, cancelamos tu visita. Avísanos si quieres coordinar otra.', { kind: 'visit_button_cancel', visitId: visit.id });
      return { handled: true, action: 'cancelled' };
    }

    case 'went':
    case 'missed': {
      const outcome = action === 'went' ? 'completed' : 'no_show';
      const updated = await markVisitOutcome({ orgId: ctx.orgId, visitId: visit.id, outcome, source: 'lead' });
      if (!updated) return { handled: true, action: 'not_found' };
      if (outcome === 'completed') await sendFeedbackRequest(ctx.orgId, updated);
      else await sendReoffer(ctx.orgId, updated);
      return { handled: true, action: 'outcome_recorded' };
    }

    case 'fb_yes':
    case 'fb_no':
    case 'fb_more': {
      const feedback = action === 'fb_yes' ? 'interested' : action === 'fb_no' ? 'not_interested' : 'wants_more';
      const updated = await recordVisitFeedback(ctx.orgId, visit.id, feedback);
      if (!updated) return { handled: true, action: 'not_found' };

      if (action === 'fb_yes') {
        await db.insert(notificationInbox).values({
          orgId: ctx.orgId,
          profileId: updated.profileId,
          type: 'visit_feedback',
          title: 'Lead interesado',
          body: `${updated.leadName ?? 'El lead'} confirmó que le interesó la visita a ${updated.listingTitle ?? 'la propiedad'}.`,
          relatedType: 'property_visit',
          relatedId: updated.id,
        });
        await ack(ctx.orgId, ctx.fromPhone, '¡Genial! Un asesor se pondrá en contacto contigo pronto.', { kind: 'visit_feedback_ack', visitId: visit.id });
        return { handled: true, action: 'feedback_recorded' };
      }
      if (action === 'fb_no') {
        await ack(ctx.orgId, ctx.fromPhone, 'Gracias por tu respuesta, seguiremos en contacto.', { kind: 'visit_feedback_ack', visitId: visit.id });
        return { handled: true, action: 'feedback_recorded' };
      }
      return { handled: true, action: 'feedback_recorded', agentFollowupText: 'Quiero ver otras opciones' };
    }
  }
}

async function runVslot(ctx: VisitButtonReplyCtx, visit: VisitRecord, slotId: string): Promise<VisitButtonReplyResult> {
  const session = await getOrCreateSession({ orgId: ctx.orgId, channel: 'whatsapp', externalId: ctx.fromPhone });
  const claim = decodeSlotId(slotId, { orgId: ctx.orgId, sessionId: session.id });
  if (!claim) {
    await ack(ctx.orgId, ctx.fromPhone, 'Ese horario ya no es válido; escribe "Reprogramar" para ver opciones nuevas.', { kind: 'visit_slot_invalid', visitId: visit.id });
    return { handled: true, action: 'not_found' };
  }

  const result = await rescheduleVisit({
    orgId: ctx.orgId,
    visitId: visit.id,
    leadId: visit.leadId,
    newStartsAt: claim.startsAt,
    visitMinutes: claim.visitMinutes,
    profileId: claim.profileId,
    actor: 'lead_button',
    sessionId: session.id,
  });

  if (!result.ok) {
    if (result.reason === 'slot_taken') {
      const list = await buildReofferList(ctx.orgId, visit);
      await sendVisitMessage({
        orgId: ctx.orgId,
        phone: ctx.fromPhone,
        bodyText: 'Ese horario se acaba de ocupar. Elige otro:',
        list: list ?? undefined,
        meta: { kind: 'visit_reschedule_offer', visitId: visit.id },
      });
      return { handled: true, action: 'slot_taken' };
    }
    return { handled: true, action: 'not_found' };
  }

  const config = await getOrCreateAgentConfig(ctx.orgId);
  await ack(ctx.orgId, ctx.fromPhone, `¡Listo, tu visita quedó reprogramada para el ${formatSlotLabel(result.visit.startsAt, config.timezone)}!`, {
    kind: 'visit_rescheduled', visitId: result.visit.id,
  });
  return { handled: true, action: 'rescheduled' };
}

export async function handleVisitButtonReply(ctx: VisitButtonReplyCtx): Promise<VisitButtonReplyResult> {
  try {
    const parsed = parseGrammar(ctx.replyId);

    if (!parsed) {
      const templateAction = TEMPLATE_TEXT_MAP[normalizeText(ctx.replyId)];
      if (!templateAction) return { handled: false };

      const visit = await findNextActiveVisitByPhone(ctx.orgId, ctx.fromPhone, 24);
      if (!visit) return { handled: true, action: 'not_found' };
      return runDirectAction(ctx, visit, templateAction);
    }

    const visit = await getVisit(ctx.orgId, parsed.visitId);
    if (!visit || visit.orgId !== ctx.orgId || visit.contactPhone !== ctx.fromPhone) {
      return { handled: true, action: 'not_found' };
    }

    if (parsed.kind === 'vslot') return runVslot(ctx, visit, parsed.slotId);
    return runDirectAction(ctx, visit, parsed.action);
  } catch (e) {
    log.error('[agent/visits/button-reply] handler failed', { orgId: ctx.orgId, err: (e as Error).message });
    return { handled: true, action: 'not_found' };
  }
}

/**
 * OVERRIDE (item C): button-replies.ts's registry only carries a boolean
 * (handled / not handled) — there is no channel back into the webhook route
 * to run an agent turn with `agentFollowupText` without editing it (out of
 * scope). Instead, a follow-up is delivered by inserting a synthetic inbound
 * message and enqueueing the same debounced turn job the webhook itself
 * uses (`queueAgentInbound`) — functionally equivalent, and keeps the
 * webhook route untouched.
 */
async function triggerAgentFollowup(orgId: string, conversationId: string | null, phone: string, text: string): Promise<void> {
  if (!conversationId) return;
  try {
    await insertMessage({
      orgId,
      conversationId,
      direction: 'inbound',
      body: text,
      status: 'received',
      agentStatus: 'pending',
      senderKind: 'contact',
      meta: { synthetic: true, source: 'visit_button_followup' },
    });
    await queueAgentInbound({ orgId, conversationId, externalPhone: phone, text, referral: null });
  } catch (e) {
    log.error('[agent/visits/button-reply] follow-up turn enqueue failed', { orgId, err: (e as Error).message });
  }
}

let registered = false;

/** Idempotent — called from job-handlers.ts' registerAgentJobHandlers(), which the webhook already calls at module load. */
export function registerVisitButtonReplyHandler(): void {
  if (registered) return;
  registered = true;

  registerButtonReplyHandler(
    (id) => isVisitButtonReply(id),
    async (ctx: ButtonReplyContext) => {
      const result = await handleVisitButtonReply({
        orgId: ctx.orgId,
        fromPhone: ctx.externalPhone,
        replyId: ctx.interactiveReplyId,
        replyTitle: ctx.text,
        whatsappConversationId: ctx.conversationId,
      });
      if (!result.handled) return false;
      if (result.agentFollowupText) {
        await triggerAgentFollowup(ctx.orgId, ctx.conversationId, ctx.externalPhone, result.agentFollowupText);
      }
      return true;
    },
  );
}
