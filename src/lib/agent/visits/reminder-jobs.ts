/**
 * agent_jobs handlers for the four VISIT_JOB_KINDS (job-plan.ts). Registered
 * with `registerAgentJobHandler` by register-jobs.ts.
 *
 * Common shape (blueprint §5.2):
 *  1. Parse the payload; malformed -> no-op + log.warn.
 *  2. `claimVisitFlag` with a guard on `startsAt`/`status`; null -> no-op
 *     (the visit was cancelled, rescheduled, or another worker already sent
 *     this flag's message).
 *  3. Send.
 *  4. A failed send releases the flag and throws, so jobs.ts retries with
 *     backoff — except `window_closed` (no approved template / no open
 *     customer-service window), which finishes the job normally with the
 *     flag left claimed, so a later run never resends (see `finishSend`).
 * Leads with `do_not_contact` never get a message.
 */

import { db } from '@/lib/db';
import { crmLeads, notificationInbox, profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { log } from '@/lib/log';
import type { InteractiveListRow, SendResult } from '@/lib/whatsapp/provider';
import { toE164 } from '@/lib/whatsapp/phone';
import { getOrCreateAgentConfig } from '../config';
import { getOrCreateSession } from '../session';
import { sendVisitMessage } from './messaging';
import { getAvailableSlotsForOrg } from './availability';
import { pickSlotsForOffer, formatSlotLabel } from './slots';
import { encodeSlotId } from './slot-id';
import { claimVisitFlag, getVisit, releaseVisitFlag } from './service';
import type { VisitJobPayload } from './job-plan';
import type { VisitRecord, VisitStatus } from './types';

/** Meta template names — approval pending (blueprint §8); until then, sends outside the window fail with window_closed and are skipped without retry (see `finishSend`). */
export const VISIT_TEMPLATES = {
  reminder24h: 'recordatorio_visita_24h',
  reminder2h: 'recordatorio_visita_2h',
  postCheck: 'feedback_post_visita',
} as const;

/**
 * Normalizes prospect/listing text (leadName, listingTitle) before it goes
 * into an outbound message body or a WhatsApp template param — Meta
 * templates reject embedded newlines and this also caps runaway CRM data
 * from blowing up a message. `len` defaults to 60 for names, pass ~80 for
 * titles.
 */
export function sanitizeText(s: string, len = 60): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, len);
}

function parseVisitJobPayload(payload: Record<string, unknown>): VisitJobPayload | null {
  const { visitId, startsAt } = payload;
  if (typeof visitId !== 'string' || !visitId) return null;
  if (typeof startsAt !== 'string' || !startsAt) return null;
  return { visitId, startsAt };
}

/**
 * Shared send-outcome handling for every job in this file: success -> no-op;
 * `window_closed` -> the flag stays claimed (no later resend) and the job
 * finishes normally, logged at info (not an error — there's no approved
 * template/open window to send through yet, see VISIT_TEMPLATES' comment);
 * any other failure releases the flag and throws so jobs.ts retries.
 */
async function finishSend(orgId: string, visitId: string, flag: string, label: string, result: SendResult): Promise<void> {
  if (result.success) return;
  if (result.error === 'window_closed') {
    log.info(`[agent/visits/reminder-jobs] ${label} window closed — skipping without retry`, { orgId, visitId, flag });
    return;
  }
  await releaseVisitFlag(orgId, visitId, flag);
  throw new Error(`[agent/visits/reminder-jobs] ${label} send failed`);
}

async function isLeadDoNotContact(orgId: string, leadId: string): Promise<boolean> {
  const rows = await db
    .select({ doNotContact: crmLeads.doNotContact })
    .from(crmLeads)
    .where(eq(crmLeads.id, leadId))
    .limit(1);
  return rows[0]?.doNotContact ?? false;
}

/** Full display record (listingTitle/leadName joined) — claimVisitFlag's own return doesn't join (service.ts override note). */
async function loadVisitForSend(orgId: string, visitId: string): Promise<VisitRecord | null> {
  return getVisit(orgId, visitId);
}

// ─── reminder_24h / reminder_2h ────────────────────────────────────────────

async function sendVisitReminder(orgId: string, visitId: string, templateName: string): Promise<SendResult> {
  const visit = await loadVisitForSend(orgId, visitId);
  if (!visit || !visit.contactPhone) return { success: true }; // nothing to send to — not a send failure

  const config = await getOrCreateAgentConfig(orgId);
  const title = sanitizeText(visit.listingTitle ?? 'la propiedad', 80);
  const when = formatSlotLabel(visit.startsAt, config.timezone);
  const name = sanitizeText(visit.leadName ?? '');
  const bodyText = `Hola${name ? ' ' + name : ''}, te recordamos tu visita a ${title} el ${when}. ¿Confirmas que asistirás?`;

  return sendVisitMessage({
    orgId,
    phone: visit.contactPhone,
    bodyText,
    buttons: [
      { id: `visit:${visit.id}:confirm`, title: 'Confirmo' },
      { id: `visit:${visit.id}:resched`, title: 'Reprogramar' },
    ],
    template: { name: templateName, bodyParams: [name || 'Hola', title, when] },
    meta: { kind: templateName === VISIT_TEMPLATES.reminder24h ? 'visit_reminder_24h' : 'visit_reminder_2h', visitId: visit.id },
  });
}

async function runReminderJob(payload: Record<string, unknown>, orgId: string, flag: 'reminder_24h_sent_at' | 'reminder_2h_sent_at', templateName: string): Promise<void> {
  const parsed = parseVisitJobPayload(payload);
  if (!parsed) {
    log.warn('[agent/visits/reminder-jobs] malformed payload', { orgId, flag });
    return;
  }

  const claimed = await claimVisitFlag(orgId, parsed.visitId, flag, { startsAtIso: parsed.startsAt, statuses: ['scheduled', 'confirmed'] });
  if (!claimed) return;

  if (await isLeadDoNotContact(orgId, claimed.leadId)) return;

  const result = await sendVisitReminder(orgId, parsed.visitId, templateName);
  await finishSend(orgId, parsed.visitId, flag, flag, result);
}

export async function handleVisitReminder24h(payload: Record<string, unknown>, orgId: string): Promise<void> {
  await runReminderJob(payload, orgId, 'reminder_24h_sent_at', VISIT_TEMPLATES.reminder24h);
}

export async function handleVisitReminder2h(payload: Record<string, unknown>, orgId: string): Promise<void> {
  await runReminderJob(payload, orgId, 'reminder_2h_sent_at', VISIT_TEMPLATES.reminder2h);
}

// ─── advisor_reminder ───────────────────────────────────────────────────────

export async function handleVisitAdvisorReminder(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const parsed = parseVisitJobPayload(payload);
  if (!parsed) {
    log.warn('[agent/visits/reminder-jobs] malformed advisor_reminder payload', { orgId });
    return;
  }

  const claimed = await claimVisitFlag(orgId, parsed.visitId, 'advisor_reminded_at', { startsAtIso: parsed.startsAt, statuses: ['scheduled', 'confirmed'] });
  if (!claimed) return;

  const visit = (await loadVisitForSend(orgId, parsed.visitId)) ?? claimed;
  const config = await getOrCreateAgentConfig(orgId);
  const when = formatSlotLabel(visit.startsAt, config.timezone);
  const leadName = visit.leadName ? sanitizeText(visit.leadName) : null;

  await db.insert(notificationInbox).values({
    orgId,
    profileId: visit.profileId,
    type: 'visit_reminder',
    title: 'Visita próxima',
    body: `Tienes una visita programada a las ${when}${leadName ? ` con ${leadName}` : ''}.`,
    relatedType: 'property_visit',
    relatedId: visit.id,
  });

  // Best-effort WhatsApp to the advisor — never blocks/retries the job.
  try {
    const rows = await db.select({ phone: profiles.phone }).from(profiles).where(eq(profiles.id, visit.profileId)).limit(1);
    const phone = rows[0]?.phone;
    if (phone) {
      await sendVisitMessage({
        orgId,
        phone: toE164(phone),
        bodyText: `Recordatorio: visita a las ${when}${leadName ? ` con ${leadName}` : ''}.`,
        meta: { kind: 'visit_advisor_reminder', visitId: visit.id },
      });
    }
  } catch (e) {
    log.warn('[agent/visits/reminder-jobs] advisor whatsapp reminder failed', { orgId, err: (e as Error).message });
  }
}

// ─── post_check ─────────────────────────────────────────────────────────────

const POST_CHECK_GUARD_STATUSES: VisitStatus[] = ['scheduled', 'confirmed', 'completed', 'no_show'];

/**
 * Up to 9 new slots for the same listing (preferred advisor = the current
 * one) — shared with button-reply.ts's `resched`/`vslot` flow.
 *
 * `declineAction` picks what the list's "No, gracias" row does when tapped:
 * 'cancel' (the no-show post-visit reoffer — declining really does mean the
 * lead doesn't want the visit anymore) or 'keep' (the reminder's
 * "Reprogramar" flow — declining must NOT cancel a visit that's still
 * scheduled; it just keeps the current time, see button-reply.ts's `keep`
 * action).
 */
export async function buildReofferList(
  orgId: string,
  visit: VisitRecord,
  declineAction: 'cancel' | 'keep',
): Promise<{ buttonText: string; rows: InteractiveListRow[] } | null> {
  if (!visit.contactPhone) return null;

  const { timezone, slots, loadByProfile } = await getAvailableSlotsForOrg({ orgId, listingId: visit.listingId });
  const offered = pickSlotsForOffer(slots, { max: 9, preferredProfileId: visit.profileId, loadByProfile, timeZone: timezone });
  if (offered.length === 0) return null;

  const session = await getOrCreateSession({ orgId, channel: 'whatsapp', externalId: visit.contactPhone });

  const rows: InteractiveListRow[] = offered.map((s) => ({
    id: `vslot:${visit.id}:${encodeSlotId({ profileId: s.profileId, listingId: visit.listingId, startsAt: s.startsAt, visitMinutes: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000) }, { orgId, sessionId: session.id })}`,
    title: formatSlotLabel(s.startsAt, timezone),
  }));
  rows.push({ id: `visit:${visit.id}:${declineAction}`, title: 'No, gracias' });

  return { buttonText: 'Ver horarios', rows };
}

async function sendReoffer(orgId: string, visit: VisitRecord): Promise<SendResult> {
  if (!visit.contactPhone) return { success: true };
  const list = await buildReofferList(orgId, visit, 'cancel');
  const title = sanitizeText(visit.listingTitle ?? 'la propiedad', 80);
  const bodyText = list
    ? `No pudiste ir a la visita a ${title}. Elige un nuevo horario:`
    : `No pudiste ir a la visita a ${title}. Escríbenos para coordinar un nuevo horario.`;

  // No approved template covers this branch (blueprint §5.1 lists only 3
  // templates and none has a slot-list/"no, gracias" quick-reply) — outside
  // the 24h window this send fails with window_closed; the caller (finishSend)
  // treats that as "nothing to do" rather than retrying forever.
  return sendVisitMessage({
    orgId,
    phone: visit.contactPhone,
    bodyText,
    list: list ?? undefined,
    meta: { kind: 'visit_reoffer', visitId: visit.id },
  });
}

async function sendFeedbackRequest(orgId: string, visit: VisitRecord): Promise<SendResult> {
  if (!visit.contactPhone) return { success: true };
  const title = sanitizeText(visit.listingTitle ?? 'la propiedad', 80);
  // No approved template covers "Me interesó / No me convenció / Ver otras"
  // — see the reoffer comment above; this branch is interactive-window-only
  // until a matching template is approved.
  const result = await sendVisitMessage({
    orgId,
    phone: visit.contactPhone,
    bodyText: `¿Qué te pareció la visita a ${title}?`,
    buttons: [
      { id: `visit:${visit.id}:fb_yes`, title: 'Me interesó' },
      { id: `visit:${visit.id}:fb_no`, title: 'No me convenció' },
      { id: `visit:${visit.id}:fb_more`, title: 'Ver otras' },
    ],
    meta: { kind: 'visit_feedback_request', visitId: visit.id },
  });
  return result;
}

async function sendWentOrMissedCheck(orgId: string, visit: VisitRecord): Promise<SendResult> {
  if (!visit.contactPhone) return { success: true };
  const title = sanitizeText(visit.listingTitle ?? 'la propiedad', 80);
  const config = await getOrCreateAgentConfig(orgId);
  return sendVisitMessage({
    orgId,
    phone: visit.contactPhone,
    bodyText: `¿Pudiste ir a la visita a ${title}?`,
    buttons: [
      { id: `visit:${visit.id}:went`, title: 'Sí, fui' },
      { id: `visit:${visit.id}:missed`, title: 'No pude ir' },
    ],
    template: { name: VISIT_TEMPLATES.postCheck, bodyParams: [sanitizeText(visit.leadName ?? 'Hola'), title, formatSlotLabel(visit.startsAt, config.timezone)] },
    meta: { kind: 'visit_post_check', visitId: visit.id },
  });
}

export async function handleVisitPostCheck(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const parsed = parseVisitJobPayload(payload);
  if (!parsed) {
    log.warn('[agent/visits/reminder-jobs] malformed post_check payload', { orgId });
    return;
  }

  const visit = await loadVisitForSend(orgId, parsed.visitId);
  if (!visit || visit.startsAt.toISOString() !== parsed.startsAt) return; // cancelled/rescheduled/drifted

  if (await isLeadDoNotContact(orgId, visit.leadId)) return;

  if (visit.status === 'completed') {
    const claimed = await claimVisitFlag(orgId, visit.id, 'feedback_requested_at', { statuses: POST_CHECK_GUARD_STATUSES });
    if (!claimed) return;
    const result = await sendFeedbackRequest(orgId, visit);
    await finishSend(orgId, visit.id, 'feedback_requested_at', 'post_check (completed)', result);
    return;
  }

  if (visit.status === 'no_show') {
    const claimed = await claimVisitFlag(orgId, visit.id, 'reoffer_sent_at', { statuses: POST_CHECK_GUARD_STATUSES });
    if (!claimed) return;
    const result = await sendReoffer(orgId, visit);
    await finishSend(orgId, visit.id, 'reoffer_sent_at', 'post_check (no_show)', result);
    return;
  }

  if (visit.status === 'scheduled' || visit.status === 'confirmed') {
    const claimed = await claimVisitFlag(orgId, visit.id, 'post_check_sent_at', { statuses: POST_CHECK_GUARD_STATUSES });
    if (!claimed) return;
    const result = await sendWentOrMissedCheck(orgId, visit);
    await finishSend(orgId, visit.id, 'post_check_sent_at', 'post_check (active)', result);
    return;
  }
  // cancelled / rescheduled -> no-op
}

// Shared with button-reply.ts's went/missed handling.
export { sendFeedbackRequest, sendReoffer };
