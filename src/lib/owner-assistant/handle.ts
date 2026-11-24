import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ownerAssistantMessages } from '@/lib/db/schema';
import { getSignedUrl } from '@/lib/storage';
import { runOcr, type RunOcrInput } from '@/lib/ocr/run-ocr';
import { log } from '@/lib/log';
import { toE164 } from '@/lib/whatsapp/phone';
import type { IWhatsAppProvider } from '@/lib/whatsapp/provider';
import type { NormalizedInboundMessage } from '@/lib/whatsapp/meta-webhook-parser';
import { parseOwnerCommand, type OwnerCommand } from './parse';
import { findVerifiedLink, verifyLinkCode } from './links';
import { findPaymentCandidates, recordApprovedPayment, recordExpense } from './records';
import { transcribeAudio, transcriptionEnabled } from './transcribe';
import { reply } from './replies';

const OCR_MIME: readonly RunOcrInput['mimeType'][] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type Outcome = { reply: string; outcome: string; recordId?: string };
type Link = { id: string; profileId: string };

/** Null when Meta retries a message already handled. */
async function claim(orgId: string, linkId: string | null, message: NormalizedInboundMessage): Promise<string | null> {
  const rows = await db
    .insert(ownerAssistantMessages)
    .values({ orgId, linkId, providerMessageId: message.providerMessageId, kind: message.type })
    .onConflictDoNothing()
    .returning({ id: ownerAssistantMessages.id });
  return rows[0]?.id ?? null;
}

async function downloadMedia(orgId: string, message: NormalizedInboundMessage, provider: IWhatsAppProvider) {
  if (!message.mediaId) return null;
  const path = `owner-assistant/${orgId}/${message.providerMessageId}`;
  const { storagePath } = await provider.downloadAttachment(orgId, message.mediaId, 'receipts', path);
  const res = await fetch(await getSignedUrl('receipts', storagePath, 60), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') ?? message.mimeType ?? '').split(';')[0].trim();
  return { storagePath, bytes: Buffer.from(await res.arrayBuffer()), contentType };
}

async function runCommand(orgId: string, link: Link, command: OwnerCommand): Promise<Outcome> {
  switch (command.kind) {
    case 'expense': {
      const description = command.description || reply('defaultExpense');
      const recordId = await recordExpense(orgId, { amount: command.amount, description });
      return { reply: reply('expenseSaved', { amount: command.amount.toFixed(2), description }), outcome: 'expense', recordId };
    }
    case 'payment': {
      const candidates = await findPaymentCandidates(orgId, command.tenantQuery);
      if (candidates.length === 0) return { reply: reply('tenantNotFound', { query: command.tenantQuery }), outcome: 'tenant_not_found' };
      if (candidates.length > 1) {
        return { reply: reply('tenantAmbiguous', { names: candidates.map((c) => c.fullName).join(', ') }), outcome: 'tenant_ambiguous' };
      }
      const [tenant] = candidates;
      const recordId = await recordApprovedPayment(orgId, link.profileId, tenant, command.amount);
      return { reply: reply('paymentSaved', { amount: command.amount.toFixed(2), name: tenant.fullName }), outcome: 'payment', recordId };
    }
    case 'link':
      return { reply: reply('alreadyLinked'), outcome: 'already_linked' };
    case 'help':
      return { reply: reply('help'), outcome: 'help' };
    default:
      return { reply: reply('notUnderstood'), outcome: 'unknown' };
  }
}

async function handleReceipt(orgId: string, message: NormalizedInboundMessage, provider: IWhatsAppProvider): Promise<Outcome> {
  const media = await downloadMedia(orgId, message, provider);
  const mimeType = OCR_MIME.find((m) => m === media?.contentType);
  if (!media || !mimeType) return { reply: reply('photoOnly'), outcome: 'unsupported_media' };

  const ocr = await runOcr({ imageBase64: media.bytes.toString('base64'), mimeType, contextTag: 'owner-assistant' });
  const amount = ocr.success ? ocr.data.amount : null;
  if (!ocr.success || !amount || amount <= 0) return { reply: reply('receiptUnreadable'), outcome: 'ocr_failed' };

  const description = (ocr.data.vendor || message.text || reply('defaultExpense')).slice(0, 200);
  const incurredOn = ocr.data.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.data.date) ? ocr.data.date : undefined;
  const recordId = await recordExpense(orgId, { amount, description, receiptPath: media.storagePath, incurredOn });
  return { reply: reply('receiptSaved', { amount: amount.toFixed(2), description }), outcome: 'expense_receipt', recordId };
}

async function handleVoice(orgId: string, link: Link, message: NormalizedInboundMessage, provider: IWhatsAppProvider): Promise<Outcome> {
  if (!transcriptionEnabled()) return { reply: reply('voiceDisabled'), outcome: 'voice_disabled' };
  const media = await downloadMedia(orgId, message, provider);
  const text = media ? await transcribeAudio(media.bytes) : null;
  if (!text) return { reply: reply('voiceUnreadable'), outcome: 'voice_failed' };
  const result = await runCommand(orgId, link, parseOwnerCommand(text));
  return { ...result, reply: `${reply('heard', { text: text.slice(0, 200) })}\n${result.reply}` };
}

function handleLinked(orgId: string, link: Link, message: NormalizedInboundMessage, provider: IWhatsAppProvider): Promise<Outcome> {
  if (message.type === 'audio') return handleVoice(orgId, link, message, provider);
  if (message.type === 'image' || message.type === 'document') return handleReceipt(orgId, message, provider);
  return runCommand(orgId, link, parseOwnerCommand(message.text));
}

async function finish(orgId: string, to: string, messageRowId: string, result: Outcome, provider: IWhatsAppProvider) {
  await db
    .update(ownerAssistantMessages)
    .set({ outcome: result.outcome, recordId: result.recordId ?? null })
    .where(eq(ownerAssistantMessages.id, messageRowId));
  const sent = await provider.sendMessage(orgId, { to, body: result.reply });
  if (!sent.success) log.warn('[owner-assistant] reply not sent', { orgId, outcome: result.outcome });
}

async function handleLinking(orgId: string, from: string, message: NormalizedInboundMessage, provider: IWhatsAppProvider): Promise<boolean> {
  const command = parseOwnerCommand(message.type === 'text' ? message.text : null);
  if (command.kind !== 'link') return false;
  const status = await verifyLinkCode(orgId, from, command.code);
  if (status === 'none') return false;
  const rowId = await claim(orgId, null, message);
  if (rowId) await finish(orgId, from, rowId, { reply: reply(`link_${status}`), outcome: `link_${status}` }, provider);
  return true;
}

/**
 * Routes a message from an admin's linked phone to the owner assistant.
 * False means "not for the assistant": the caller runs the normal tenant/lead flow.
 */
export async function handleOwnerAssistantMessage(
  orgId: string,
  message: NormalizedInboundMessage,
  provider: IWhatsAppProvider
): Promise<boolean> {
  const from = toE164(message.from);
  const link = await findVerifiedLink(orgId, from);
  if (!link) return handleLinking(orgId, from, message, provider);

  const rowId = await claim(orgId, link.id, message);
  if (!rowId) return true;
  let result: Outcome;
  try {
    result = await handleLinked(orgId, link, message, provider);
  } catch (e) {
    log.error('[owner-assistant] failed', { orgId, error: e instanceof Error ? e.message : 'unknown' });
    result = { reply: reply('failed'), outcome: 'error' };
  }
  await finish(orgId, from, rowId, result, provider);
  return true;
}
