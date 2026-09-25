/**
 * The only place that sends WhatsApp free text on behalf of the org — the
 * agent (senderKind='agent'), a human advisor from the inbox (senderKind=
 * 'human'), or the system (senderKind='system'). Enforces the 24h customer-
 * service window when an agent session is linked to the conversation.
 */

import { db } from '@/lib/db';
import { whatsappConversations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { insertMessage, updateConversationActivity } from '@/lib/whatsapp/db';
import { getSessionByConversation, isWindowOpen } from './session';

export type SendOutcome =
  | { ok: true; messageId: string }
  | { ok: false; code: 'WINDOW_CLOSED' | 'PROVIDER_ERROR' | 'NOT_FOUND'; error?: string };

export interface SendWhatsAppTextArgs {
  orgId: string;
  conversationId: string;
  body: string;
  senderKind: 'agent' | 'human' | 'system';
  sentByProfileId?: string | null;
  /** Default true — checks the linked agent session's window, if one exists. */
  enforceWindow?: boolean;
}

export async function sendWhatsAppText(args: SendWhatsAppTextArgs): Promise<SendOutcome> {
  const enforceWindow = args.enforceWindow ?? true;

  const convRows = await db
    .select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
    .from(whatsappConversations)
    .where(and(eq(whatsappConversations.id, args.conversationId), eq(whatsappConversations.orgId, args.orgId)))
    .limit(1);

  const conv = convRows[0];
  if (!conv) return { ok: false, code: 'NOT_FOUND' };

  if (enforceWindow) {
    // No agent session (a tenant conversation) → no window_expires_at to check;
    // tenant behaviour is unchanged and unrestricted by the 24h rule.
    const session = await getSessionByConversation(args.orgId, args.conversationId);
    if (session && !isWindowOpen(session)) {
      return { ok: false, code: 'WINDOW_CLOSED' };
    }
  }

  const provider = getWhatsAppProvider();
  const sendResult = await provider.sendMessage(args.orgId, {
    to: conv.externalPhone, // PII — never logged
    body: args.body,
  });

  if (!sendResult.success) {
    log.error('[agent/outbound] provider send failed', { orgId: args.orgId, error: sendResult.error });
  }

  let messageId: string | null = null;
  try {
    messageId = await insertMessage({
      orgId: args.orgId,
      conversationId: args.conversationId,
      direction: 'outbound',
      providerMessageId: sendResult.providerMessageId ?? null,
      body: args.body,
      status: sendResult.success ? 'sent' : 'failed',
      senderKind: args.senderKind,
      sentByProfileId: args.sentByProfileId ?? null,
    });
  } catch (err) {
    log.error('[agent/outbound] insertMessage failed', { orgId: args.orgId, err: (err as Error).message });
    return { ok: false, code: 'PROVIDER_ERROR', error: (err as Error).message };
  }

  if (!sendResult.success) {
    return { ok: false, code: 'PROVIDER_ERROR', error: sendResult.error };
  }

  if (!messageId) {
    // Duplicate providerMessageId — treat as already sent rather than an error.
    return { ok: false, code: 'PROVIDER_ERROR', error: 'duplicate provider_message_id' };
  }

  await updateConversationActivity(args.conversationId, false);

  return { ok: true, messageId };
}
