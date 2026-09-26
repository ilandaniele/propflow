/**
 * VOICE_JOB_KINDS.visitConfirmationMessage — sends the "Confirmo VOZ-XXXXXX"
 * WhatsApp message that a voice call's book_visit branch queues (never a
 * direct property_visits write; redemption happens in web-handoff-redeem.ts).
 */

import { db } from '@/lib/db';
import { agentWebHandoffCodes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '../config';
import { getLead } from '../lead';
import { getListingDetails } from '../listings';
import { sendVisitMessage } from '../visits/messaging';
import { formatSlotLabel } from '../visits/slots';

const CONFIRM_QUICK_REPLY_TEXT = 'Confirmar visita';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Accent/case-insensitive match of the bare "Confirmar visita" quick-reply text (no typed code). */
export function isVoiceConfirmText(text: string | null): boolean {
  if (!text) return false;
  return normalize(text) === normalize(CONFIRM_QUICK_REPLY_TEXT);
}

export async function sendVoiceVisitConfirmation(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const codeId = typeof payload.codeId === 'string' ? payload.codeId : null;
  if (!codeId) return;

  const rows = await db
    .select()
    .from(agentWebHandoffCodes)
    .where(and(eq(agentWebHandoffCodes.id, codeId), eq(agentWebHandoffCodes.orgId, orgId)))
    .limit(1);
  const code = rows[0];

  // Pending & unexpired only — a code already redeemed/expired/superseded by
  // the time this job runs is a no-op, never re-sent.
  if (!code || code.status !== 'pending' || code.expiresAt.getTime() <= Date.now()) return;
  if (!code.targetPhone || !code.startsAt || !code.visitMinutes) return; // guarded by chk_handoff_source; defensive only

  const lead = code.leadId ? await getLead(orgId, code.leadId) : null;
  if (lead?.doNotContact) return;

  const config = await getOrCreateAgentConfig(orgId);
  const label = formatSlotLabel(code.startsAt, config.timezone);
  const listing = code.listingId ? await getListingDetails(orgId, code.listingId) : null;
  const title = listing?.title ?? 'la propiedad';
  const firstName = lead?.fullName?.trim().split(/\s+/)[0] || null;

  const bodyText = `Para confirmar tu visita a "${title}" el ${label}, tocá el botón de abajo o escribinos "${CONFIRM_QUICK_REPLY_TEXT}".`;

  const result = await sendVisitMessage({
    orgId,
    phone: code.targetPhone,
    bodyText,
    // Meta limit: button titles ≤20 chars — "Confirmo " + 6-char code = 19.
    buttons: [{ id: `vcode:${code.code}`, title: `Confirmo ${code.code}` }],
    template: {
      name: 'confirmar_visita_voz',
      bodyParams: [firstName ?? 'Hola', title, label, code.code],
    },
    meta: { kind: 'voice_visit_confirmation', codeId: code.id },
  });

  if (!result.success) {
    // Thrown so agent_jobs retries (this job kind, like every other visit
    // outbound, is safe to re-run — sendVisitMessage is not itself
    // idempotent against retries, but re-sending the same pending code's
    // confirmation is harmless: the recipient just gets the message again).
    throw new Error(`[agent/voice/visit-confirmation] sendVisitMessage failed: ${result.error ?? 'unknown'}`);
  }
}
