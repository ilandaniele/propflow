/**
 * WhatsApp-side redemption of a web handoff code (Phase 7 decision 6): the
 * visitor's own WhatsApp message ("Hola, confirmo mi visita. Código
 * WEB-XXXXXX") is the proof they own the phone. Only here does a web-
 * originated booking actually touch property_visits.
 *
 * Hooked into processWhatsAppAgentTurn (whatsapp-dispatch.ts), after gating
 * and before runAgentTurn — so it only ever runs for a prospect phone the
 * WhatsApp agent is already allowed to talk to (Phase 2 rule 4: tenant
 * phones never reach this pipeline).
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { getOrCreateAgentConfig } from './config';
import { getListingDetails } from './listings';
import { bookVisit } from './visits/service';
import { formatSlotLabel } from './visits/slots';
import { setSessionLead } from './session';
import { recordAgentEvent } from './events';
import {
  claimHandoffCode,
  extractHandoffCode,
  finishHandoffCode,
} from '@/lib/widget/handoff-codes';

export type RedeemOutcome =
  | { kind: 'none' }
  | { kind: 'visit_booked'; replyText: string; visitId: string }
  | { kind: 'visit_failed'; note: string }
  | { kind: 'linked'; note: string }
  | { kind: 'expired'; note: string };

export interface RedeemWebHandoffCodeArgs {
  orgId: string;
  phoneE164: string;
  text: string;
  whatsappSession: { id: string; leadId: string | null };
}

export interface LinkLeadFromCodeResult {
  leadId: string | null;
  /** Set when the lead already had a *verified* phone that differs from the
   * redeemer's — we never overwrite that, but the caller should still know. */
  phoneConflictNote: string | null;
}

/**
 * When the WhatsApp session has no lead yet and the code carries one, links
 * it (setSessionLead) and reconciles that lead's phone against the
 * redeemer's proven number (phoneE164 — it's the one that just sent the
 * WhatsApp message):
 *  - phone NULL, or stored but not yet verified: overwrite with the
 *    redeemer's phone and flip phoneVerified=true.
 *  - phone already verified and equal to the redeemer's: nothing to do.
 *  - phone already verified and DIFFERENT from the redeemer's: never
 *    overwritten — a note is returned so the caller can record it.
 */
async function linkLeadFromCode(
  orgId: string,
  whatsappSession: { id: string; leadId: string | null },
  codeLeadId: string | null,
  phoneE164: string,
): Promise<LinkLeadFromCodeResult> {
  if (whatsappSession.leadId || !codeLeadId) {
    return { leadId: whatsappSession.leadId, phoneConflictNote: null };
  }

  await setSessionLead(whatsappSession.id, codeLeadId);

  const [current] = await db
    .select({ phone: crmLeads.phone, sourceMeta: crmLeads.sourceMeta })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, codeLeadId), eq(crmLeads.orgId, orgId)))
    .limit(1);

  const storedPhone = current?.phone ?? null;
  const storedVerified = (current?.sourceMeta as Record<string, unknown> | null)?.phoneVerified === true;

  if (storedVerified && storedPhone && storedPhone !== phoneE164) {
    return {
      leadId: codeLeadId,
      phoneConflictNote: `El lead ya tenía un teléfono verificado (${storedPhone}) distinto al que escribió por WhatsApp (${phoneE164}); no se sobrescribió.`,
    };
  }

  await db
    .update(crmLeads)
    .set({
      phone: phoneE164,
      sourceMeta: sql`jsonb_set(coalesce(${crmLeads.sourceMeta}, '{}'::jsonb), '{phoneVerified}', 'true'::jsonb, true)`,
    })
    .where(and(eq(crmLeads.id, codeLeadId), eq(crmLeads.orgId, orgId)));

  return { leadId: codeLeadId, phoneConflictNote: null };
}

/**
 * NOTE (item C, staying within its exclusive file list — types.ts is item
 * A's): the blueprint's `recordAgentEvent('web_handoff_redeemed', { kind,
 * outcome })` would need a new AgentEventKind member added to
 * src/lib/agent/types.ts, which item C does not own. Recorded instead under
 * the existing 'handoff' kind, with the same { kind, outcome } shape nested
 * in `data.web_handoff_redeemed` so it stays queryable/distinguishable in
 * the inbox timeline without touching A's file.
 */
async function recordRedemptionEvent(
  orgId: string,
  sessionId: string,
  kind: 'visit' | 'continue',
  outcome: 'visit_booked' | 'visit_failed' | 'linked',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await recordAgentEvent({
    orgId,
    sessionId,
    kind: 'handoff',
    data: { web_handoff_redeemed: { kind, outcome, ...extra } },
  });
}

export async function redeemWebHandoffCode(a: RedeemWebHandoffCodeArgs): Promise<RedeemOutcome> {
  const code = extractHandoffCode(a.text);
  if (!code) return { kind: 'none' };

  const claimed = await claimHandoffCode(a.orgId, code, a.phoneE164, a.whatsappSession.id);
  if (claimed === null) return { kind: 'none' };
  if (claimed === 'expired') {
    return { kind: 'expired', note: `Intentó confirmar con el código ${code}, que ya venció; ofrecele generar uno nuevo.` };
  }

  const { leadId, phoneConflictNote } = await linkLeadFromCode(
    a.orgId,
    a.whatsappSession,
    claimed.leadId,
    a.phoneE164,
  );

  if (claimed.kind === 'continue') {
    await finishHandoffCode(claimed.id, { status: 'redeemed', result: 'linked' });
    await recordRedemptionEvent(a.orgId, a.whatsappSession.id, 'continue', 'linked', {
      ...(phoneConflictNote ? { phoneConflictNote } : {}),
    });
    return {
      kind: 'linked',
      note: phoneConflictNote
        ? `El usuario viene del chat web; su perfil ya está cargado. ${phoneConflictNote}`
        : 'El usuario viene del chat web; su perfil ya está cargado.',
    };
  }

  // kind === 'visit'
  const config = await getOrCreateAgentConfig(a.orgId);
  const label = formatSlotLabel(claimed.startsAt as Date, config.timezone);
  let listingTitle: string | null = null;
  if (claimed.listingId) {
    const listing = await getListingDetails(a.orgId, claimed.listingId);
    listingTitle = listing?.title ?? null;
  }

  const bookingLeadId = leadId ?? claimed.leadId;
  if (!bookingLeadId) {
    await finishHandoffCode(claimed.id, { status: 'failed', result: 'lead_not_found' });
    await recordRedemptionEvent(a.orgId, a.whatsappSession.id, 'visit', 'visit_failed', { reason: 'lead_not_found' });
    return {
      kind: 'visit_failed',
      note: `Intentó confirmar la visita web a ${listingTitle ?? 'la propiedad'} el ${label} pero no encontramos su perfil; contale que empiece de nuevo.`,
    };
  }

  const result = await bookVisit({
    orgId: a.orgId,
    leadId: bookingLeadId,
    listingId: claimed.listingId,
    profileId: claimed.profileId as string,
    startsAt: claimed.startsAt as Date,
    visitMinutes: claimed.visitMinutes as number,
    contactPhone: a.phoneE164,
    createdBy: 'agent',
    sourceChannel: 'web',
    sessionId: a.whatsappSession.id,
    requirePublishedListing: true,
    enforcePhoneCap: true,
  });

  if (result.ok) {
    const titlePart = listingTitle ? ` para "${listingTitle}"` : '';
    const replyText = `¡Listo! Confirmamos tu visita${titlePart} para el ${label}.`;
    await finishHandoffCode(claimed.id, { status: 'redeemed', visitId: result.visit.id, result: 'visit_booked' });
    await recordRedemptionEvent(a.orgId, a.whatsappSession.id, 'visit', 'visit_booked', {
      ...(phoneConflictNote ? { phoneConflictNote } : {}),
    });
    return { kind: 'visit_booked', replyText, visitId: result.visit.id };
  }

  await finishHandoffCode(claimed.id, { status: 'failed', result: result.reason });
  await recordRedemptionEvent(a.orgId, a.whatsappSession.id, 'visit', 'visit_failed', { reason: result.reason });
  return {
    kind: 'visit_failed',
    note: `Intentó confirmar la visita web a ${listingTitle ?? 'la propiedad'} el ${label} pero falló (${result.reason}); ofrecé horarios nuevos con get_available_slots.`,
  };
}
