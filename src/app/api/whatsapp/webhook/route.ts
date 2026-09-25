/**
 * GET  /api/whatsapp/webhook — Meta subscription handshake (hub.challenge).
 * POST /api/whatsapp/webhook
 * - No auth (public, signature-validated)
 * - Rate limit: 60/min/IP
 * - Two payload shapes are accepted:
 *   1. Meta's real Cloud API envelope (`object: 'whatsapp_business_account'`),
 *      signed with X-Hub-Signature-256 + META_APP_SECRET, org resolved via
 *      org_channels (phone_number_id).
 *   2. This app's flat mock-provider payload (dev/tests only), signed with
 *      X-Signature + WHATSAPP_WEBHOOK_SECRET, org resolved as the first org
 *      (single-tenant dev assumption — never used for real Meta traffic).
 * - Idempotent on provider_message_id
 * - Emits events via in-process bus (fire-and-forget)
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { webhookRateLimit } from '@/lib/ratelimit';
import { validateHmacSignature } from '@/lib/whatsapp/signature';
import { verifyMetaSignature } from '@/lib/whatsapp/meta-signature';
import { InboundWebhookSchema } from '@/lib/schemas/whatsapp';
import {
  upsertConversation,
  insertMessage,
  findTenantByPhone,
  findOrgIdByWhatsAppPhoneNumberId,
  updateConversationActivity,
  updateMessageStatusByProviderId,
  finishClaimedInbound,
} from '@/lib/whatsapp/db';
import { toE164 } from '@/lib/whatsapp/phone';
import {
  isMetaWebhookBody,
  parseMetaWebhookBody,
  type NormalizedInboundMessage,
} from '@/lib/whatsapp/meta-webhook-parser';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { classifyMessage } from '@/lib/whatsapp/classify';
import { emit } from '@/lib/events/emit';
import { registerAllHandlers } from '@/lib/events/handlers';
import { log } from '@/lib/log';
import { serverEnv } from '@/lib/env';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { queueAgentInbound, scheduleAgentDrain } from '@/lib/agent/whatsapp-dispatch';
import { registerAgentJobHandlers } from '@/lib/agent/job-handlers';
import { dispatchButtonReply } from '@/lib/agent/button-replies';

// Register event handlers on module load
registerAllHandlers();
// Register agent_jobs handlers on module load (drainAgentJobs needs one for
// AGENT_WHATSAPP_TURN_JOB — see job-handlers.ts / handoffs/phase2-blueprint.md §4).
registerAgentJobHandlers();

const ATTACHMENT_KINDS = ['image', 'document', 'audio', 'video'] as const;
type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

function isAttachmentKind(type: string): type is AttachmentKind {
  return (ATTACHMENT_KINDS as readonly string[]).includes(type);
}

/**
 * GET handshake — Meta calls this once when you subscribe the webhook URL
 * in the App Dashboard. Must echo back hub.challenge verbatim on success.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Missing hub.mode/hub.verify_token/hub.challenge' } },
      { status: 400 }
    );
  }

  const provider = getWhatsAppProvider();
  const verified = provider.verifyWebhookToken?.(token) ?? false;

  if (!verified) {
    log.warn('[webhook] GET handshake failed verify_token check');
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Verify token mismatch' } }, { status: 403 });
  }

  // Meta expects the raw challenge string back, not JSON.
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Rate limit first (before any DB work)
  const rl = webhookRateLimit(request);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) },
      }
    );
  }

  // Read raw body for signature validation (must happen before JSON.parse)
  const rawBody = Buffer.from(await request.arrayBuffer());

  // Peek the shape (both branches still validate the signature before trusting anything).
  let body: unknown;
  let parseFailed = false;
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    parseFailed = true;
  }

  if (!parseFailed && isMetaWebhookBody(body)) {
    return handleMetaPayload(request, rawBody, body);
  }

  // Mock-provider payload (dev/tests) — unchanged historical behavior.
  return handleMockPayload(request, rawBody, parseFailed ? undefined : body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta real Cloud API payload
// ─────────────────────────────────────────────────────────────────────────────

async function handleMetaPayload(
  request: NextRequest,
  rawBody: Buffer,
  body: ReturnType<typeof JSON.parse>
): Promise<NextResponse> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Webhook secret not configured' } },
      { status: 503 }
    );
  }

  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyMetaSignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature validation failed' } },
      { status: 401 }
    );
  }

  const provider = getWhatsAppProvider();
  const changes = parseMetaWebhookBody(body);
  let anyQueued = false;

  for (const change of changes) {
    const orgId = await findOrgIdByWhatsAppPhoneNumberId(change.phoneNumberId);
    if (!orgId) {
      log.warn('[webhook] no org_channels row for phone_number_id — skipping change');
      continue;
    }

    for (const status of change.statuses) {
      await updateMessageStatusByProviderId(orgId, status.providerMessageId, status.status);
    }

    for (const message of change.messages) {
      if (await processMetaMessage(orgId, message, provider)) anyQueued = true;
    }
  }

  if (anyQueued) scheduleAgentDrain();

  return NextResponse.json({ ok: true });
}

/** Returns true if this message was handed to the agent's debounced turn queue. */
async function processMetaMessage(
  orgId: string,
  message: NormalizedInboundMessage,
  provider: ReturnType<typeof getWhatsAppProvider>
): Promise<boolean> {
  const from = toE164(message.from);

  const tenant = await findTenantByPhone(orgId, from);

  const conversationId = await upsertConversation({
    orgId,
    externalPhone: from,
    tenantId: tenant?.id ?? null,
  });

  const attachmentKind: AttachmentKind | null = isAttachmentKind(message.type) ? message.type : null;
  let attachmentPath: string | null = null;

  if (attachmentKind && message.mediaId) {
    const storagePath = `whatsapp/${orgId}/${conversationId}/${message.providerMessageId}`;
    try {
      const result = await provider.downloadAttachment(orgId, message.mediaId, 'receipts', storagePath);
      attachmentPath = result.storagePath;
    } catch (e) {
      log.error('[webhook] attachment download failed', { orgId, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  const classification = await classifyMessage(message.text, attachmentKind, orgId);

  // Tenant wins (decision 4): tenant conversations never get agentStatus, so
  // the existing tenant flow runs unchanged. Otherwise mark pending only when
  // the org has WhatsApp agent live — see queueAgentInbound() below.
  const agentEnabled = !tenant && (await getOrCreateAgentConfig(orgId)).channelsEnabled.whatsapp;

  const messageId = await insertMessage({
    orgId,
    conversationId,
    direction: 'inbound',
    providerMessageId: message.providerMessageId,
    body: message.text,
    attachmentPath,
    attachmentKind,
    classification: classification.classification,
    status: 'received',
    meta: {
      from_provider: true,
      timestamp: message.timestamp,
      interactive_reply_id: message.interactiveReplyId,
      referral: message.referral,
    },
    agentStatus: agentEnabled ? 'pending' : null,
    senderKind: 'contact',
  });

  if (!messageId) return false; // duplicate — already processed

  await updateConversationActivity(conversationId, true);

  if (message.type === 'text') {
    emit('whatsapp.message.received', {
      orgId,
      conversationId,
      messageId,
      tenantId: tenant?.id ?? null,
      body: message.text,
    }, `whatsapp.message.received:${message.providerMessageId}`);
  }

  if (attachmentKind && attachmentPath) {
    emit('whatsapp.attachment.received', {
      orgId,
      conversationId,
      messageId,
      tenantId: tenant?.id ?? null,
      attachmentKind,
      attachmentPath,
      classification: classification.classification,
    }, `whatsapp.attachment.received:${message.providerMessageId}`);
  }

  if (!agentEnabled) return false;

  // EXTENSION POINT (Phase 3-4, see src/lib/agent/button-replies.ts): a
  // button/list reply is routed to any registered handler BEFORE the agent
  // turn. A handler that reports it fully handled the reply (e.g. it sent
  // its own message) skips the normal agent pipeline for this message.
  if (message.interactiveReplyId) {
    const handled = await dispatchButtonReply({
      orgId,
      conversationId,
      externalPhone: from,
      interactiveReplyId: message.interactiveReplyId,
      text: message.text,
    });
    if (handled) {
      // Handled outside the agent pipeline — clear the 'pending' agentStatus
      // set by insertMessage() above so the sweeper never resurrects it.
      await finishClaimedInbound([messageId], 'processed');
      return false;
    }
  }

  return queueAgentInbound({
    orgId,
    conversationId,
    externalPhone: from,
    text: message.text,
    referral: message.referral,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock-provider flat payload (dev/tests) — unchanged from the original route.
// ─────────────────────────────────────────────────────────────────────────────

async function handleMockPayload(
  request: NextRequest,
  rawBody: Buffer,
  preParsedBody: unknown
): Promise<NextResponse> {
  const signature = request.headers.get('x-signature') ?? '';
  const secret = serverEnv.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Webhook secret not configured' } },
      { status: 503 }
    );
  }

  if (!validateHmacSignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature validation failed' } },
      { status: 401 }
    );
  }

  if (preParsedBody === undefined) {
    return NextResponse.json(
      { error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON' } },
      { status: 400 }
    );
  }

  const parsed = InboundWebhookSchema.safeParse(preParsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_PAYLOAD', message: 'Validation failed', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { provider_message_id, from, type, text, attachment_url, timestamp } = parsed.data;

  // Single-org dev/test assumption — real Meta traffic never reaches this branch.
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(1);

  if (!orgRows.length) {
    log.error('[webhook] no organizations found');
    return NextResponse.json({ ok: true }); // Return 200 to prevent provider retry
  }

  const orgId = orgRows[0].id;

  const tenant = await findTenantByPhone(orgId, from);

  const conversationId = await upsertConversation({
    orgId,
    externalPhone: from,
    tenantId: tenant?.id ?? null,
  });

  const attachmentKind = isAttachmentKind(type) ? type : null;
  const classification = await classifyMessage(text ?? null, attachmentKind, orgId);

  // Tenant wins (decision 4); otherwise mark pending only when the org has
  // WhatsApp agent live — mirrors handleMetaPayload above.
  const agentEnabled = !tenant && (await getOrCreateAgentConfig(orgId)).channelsEnabled.whatsapp;

  const messageId = await insertMessage({
    orgId,
    conversationId,
    direction: 'inbound',
    providerMessageId: provider_message_id,
    body: text ?? null,
    attachmentPath: null, // path set after download; attachment_url is provider URL
    attachmentKind,
    classification: classification.classification,
    status: 'received',
    meta: { from_provider: true, timestamp, attachment_url: attachment_url ?? null },
    agentStatus: agentEnabled ? 'pending' : null,
    senderKind: 'contact',
  });

  if (!messageId) {
    // Duplicate — already processed
    return NextResponse.json({ ok: true });
  }

  await updateConversationActivity(conversationId, true);

  if (type === 'text') {
    emit('whatsapp.message.received', {
      orgId,
      conversationId,
      messageId,
      tenantId: tenant?.id ?? null,
      body: text ?? null,
    }, `whatsapp.message.received:${provider_message_id}`);
  }

  if (attachmentKind && attachment_url) {
    emit('whatsapp.attachment.received', {
      orgId,
      conversationId,
      messageId,
      tenantId: tenant?.id ?? null,
      attachmentKind,
      attachmentPath: attachment_url, // will be downloaded by handler
      classification: classification.classification,
    }, `whatsapp.attachment.received:${provider_message_id}`);
  }

  // Mock payloads (dev/tests) never carry a button/list reply, so there's no
  // button-replies.ts extension point here — see processMetaMessage above.
  if (agentEnabled) {
    const queued = await queueAgentInbound({ orgId, conversationId, externalPhone: from, text: text ?? null, referral: null });
    if (queued) scheduleAgentDrain();
  }

  return NextResponse.json({ ok: true });
}
