/**
 * Parser for Meta's real WhatsApp Cloud API webhook payload shape
 * (`entry[].changes[].value`), as opposed to this app's flat mock-provider
 * payload (handled separately in the webhook route for tests/dev).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 *
 * Security: bodies/phone numbers are PII — callers must not log the parsed
 * `from` / `text` fields directly (see meta-provider.ts conventions).
 */

export type NormalizedInboundType = 'text' | 'image' | 'document' | 'audio' | 'video';

export interface NormalizedInboundMessage {
  providerMessageId: string;
  from: string; // E.164 with '+' (normalized by the caller via toE164)
  type: NormalizedInboundType;
  text: string | null;
  mediaId: string | null;
  mimeType: string | null;
  timestamp: string; // ISO8601
  /** Set when the message is a button/list reply — used for future button routing (Fase 4). */
  interactiveReplyId: string | null;
  /** Click-to-WhatsApp ad attribution, when present. */
  referral: Record<string, unknown> | null;
}

export interface NormalizedStatus {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string; // ISO8601
}

export interface MetaWebhookChange {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  messages: NormalizedInboundMessage[];
  statuses: NormalizedStatus[];
}

interface MetaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
}

interface MetaEntry {
  changes?: Array<{ field?: string; value?: MetaValue }>;
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

/** True when the parsed JSON body matches Meta's real webhook envelope. */
export function isMetaWebhookBody(body: unknown): body is MetaWebhookBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as MetaWebhookBody).object === 'whatsapp_business_account'
  );
}

function unixToIso(seconds: unknown): string {
  const n = Number(seconds);
  return new Date((Number.isFinite(n) ? n : Date.now() / 1000) * 1000).toISOString();
}

function toIsoNow(): string {
  return new Date().toISOString();
}

const STATUS_MAP: Record<string, NormalizedStatus['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

/** Parse one Meta message object into our normalized shape, or null if unsupported. */
function parseMessage(raw: Record<string, unknown>): NormalizedInboundMessage | null {
  const id = raw.id;
  const from = raw.from;
  const type = raw.type;
  if (typeof id !== 'string' || typeof from !== 'string' || typeof type !== 'string') return null;

  const timestamp = unixToIso(raw.timestamp);
  const referral = (raw.referral as Record<string, unknown> | undefined) ?? null;

  const base = { providerMessageId: id, from, timestamp, referral };

  switch (type) {
    case 'text': {
      const body = (raw.text as { body?: string } | undefined)?.body ?? null;
      return { ...base, type: 'text', text: body, mediaId: null, mimeType: null, interactiveReplyId: null };
    }
    case 'image':
    case 'document':
    case 'audio':
    case 'video': {
      const media = raw[type] as { id?: string; mime_type?: string; caption?: string } | undefined;
      return {
        ...base,
        type,
        text: media?.caption ?? null,
        mediaId: media?.id ?? null,
        mimeType: media?.mime_type ?? null,
        interactiveReplyId: null,
      };
    }
    case 'interactive': {
      const interactive = raw.interactive as
        | { type?: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
        | undefined;
      const reply = interactive?.button_reply ?? interactive?.list_reply;
      return {
        ...base,
        type: 'text',
        text: reply?.title ?? null,
        mediaId: null,
        mimeType: null,
        interactiveReplyId: reply?.id ?? null,
      };
    }
    case 'button': {
      const button = raw.button as { text?: string; payload?: string } | undefined;
      return {
        ...base,
        type: 'text',
        text: button?.text ?? null,
        mediaId: null,
        mimeType: null,
        interactiveReplyId: button?.payload ?? null,
      };
    }
    default:
      // location, sticker, contacts, reaction, unsupported types — not handled in Phase 0.
      return null;
  }
}

function parseStatus(raw: Record<string, unknown>): NormalizedStatus | null {
  const id = raw.id;
  const statusRaw = raw.status;
  if (typeof id !== 'string' || typeof statusRaw !== 'string') return null;
  const mapped = STATUS_MAP[statusRaw];
  if (!mapped) return null;
  return { providerMessageId: id, status: mapped, timestamp: unixToIso(raw.timestamp) || toIsoNow() };
}

/**
 * Flatten a Meta webhook body into one entry per `changes[].value` block that
 * carries a phone_number_id, with normalized messages/statuses attached.
 */
export function parseMetaWebhookBody(body: MetaWebhookBody): MetaWebhookChange[] {
  const out: MetaWebhookChange[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      const messages = (value.messages ?? [])
        .map(parseMessage)
        .filter((m): m is NormalizedInboundMessage => m !== null);
      const statuses = (value.statuses ?? [])
        .map(parseStatus)
        .filter((s): s is NormalizedStatus => s !== null);

      out.push({
        phoneNumberId,
        displayPhoneNumber: value.metadata?.display_phone_number ?? null,
        messages,
        statuses,
      });
    }
  }

  return out;
}
