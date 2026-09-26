/**
 * The only send path for visit-related WhatsApp messages (reminders,
 * post-visit follow-ups, button-reply acknowledgements). Reuses the same
 * conversation/message bookkeeping as `outbound.ts` (upsertConversation +
 * insertMessage) so every send shows up in the inbox, but goes straight to
 * the provider instead of `sendWhatsAppText` because it also needs
 * interactive buttons/lists and templates, which that helper doesn't do.
 *
 * Never logs a phone number or a message body (PII).
 */

import { getWhatsAppProvider } from '@/lib/whatsapp';
import type { InteractiveButton, InteractiveListRow, SendResult } from '@/lib/whatsapp/provider';
import { insertMessage, updateConversationActivity, upsertConversation } from '@/lib/whatsapp/db';
import { log } from '@/lib/log';
import { getOrCreateSession, isWindowOpen as isSessionWindowOpen } from '../session';

export interface VisitOutbound {
  orgId: string;
  /** E.164 with a leading '+' — PII, never logged. */
  phone: string;
  bodyText: string;
  /** Max 3, titles max 20 chars (Meta limit) — sent only when the 24h window is open. */
  buttons?: InteractiveButton[];
  /** Max 10 rows — sent only when the 24h window is open. */
  list?: { buttonText: string; rows: InteractiveListRow[] };
  /** Used instead of buttons/list/text when the 24h window is closed. */
  template?: { name: string; bodyParams: string[] };
  /** e.g. { kind: 'visit_reminder_24h', visitId } — stored on the outbound whatsapp_messages row. */
  meta: Record<string, unknown>;
}

/** True if this phone has an open 24h customer-service window on its WhatsApp agent session. */
export async function isWindowOpen(orgId: string, phone: string): Promise<boolean> {
  const session = await getOrCreateSession({ orgId, channel: 'whatsapp', externalId: phone });
  return isSessionWindowOpen(session);
}

/**
 * Plain-text rendering used when the window is open but the provider lacks
 * interactive support (e.g. MockWhatsAppProvider has no
 * sendInteractiveButtons) — keeps dev/test/mock deployments functional
 * instead of silently dropping the buttons/list.
 */
function renderPlainFallback(m: VisitOutbound): string {
  const lines = [m.bodyText];
  if (m.buttons) for (const b of m.buttons) lines.push(`- ${b.title}`);
  if (m.list) for (const r of m.list.rows) lines.push(`- ${r.title}`);
  return lines.join('\n');
}

export async function sendVisitMessage(m: VisitOutbound): Promise<SendResult> {
  const provider = getWhatsAppProvider();
  const open = await isWindowOpen(m.orgId, m.phone);

  let result: SendResult;
  if (open) {
    if (m.list && m.list.rows.length > 0 && provider.sendInteractiveList) {
      result = await provider.sendInteractiveList(m.orgId, {
        to: m.phone,
        bodyText: m.bodyText,
        buttonText: m.list.buttonText,
        rows: m.list.rows,
      });
    } else if (m.buttons && m.buttons.length > 0 && provider.sendInteractiveButtons) {
      result = await provider.sendInteractiveButtons(m.orgId, { to: m.phone, bodyText: m.bodyText, buttons: m.buttons });
    } else {
      result = await provider.sendMessage(m.orgId, { to: m.phone, body: renderPlainFallback(m) });
    }
  } else {
    if (!m.template || !provider.sendTemplate) {
      // Not approved / not configured yet — never write outside the window.
      return { success: false, error: 'window_closed' };
    }
    result = await provider.sendTemplate(m.orgId, {
      to: m.phone,
      templateName: m.template.name,
      languageCode: 'es',
      bodyParams: m.template.bodyParams,
    });
  }

  const conversationId = await upsertConversation({ orgId: m.orgId, externalPhone: m.phone });

  try {
    await insertMessage({
      orgId: m.orgId,
      conversationId,
      direction: 'outbound',
      providerMessageId: result.providerMessageId ?? null,
      body: m.bodyText,
      status: result.success ? 'sent' : 'failed',
      senderKind: 'system',
      meta: m.meta,
    });
  } catch (err) {
    log.error('[agent/visits/messaging] insertMessage failed', { orgId: m.orgId, err: (err as Error).message });
  }

  if (result.success) await updateConversationActivity(conversationId, false);

  return result;
}
