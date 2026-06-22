/**
 * POST /api/whatsapp/webhook
 * - No auth (public, signature-validated)
 * - Rate limit: 60/min/IP
 * - Signature: HMAC-SHA256 via X-Signature: sha256=<hex>
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
import { InboundWebhookSchema } from '@/lib/schemas/whatsapp';
// TODO(W6): remove createAdminClient once whatsapp/db lib functions are migrated to Drizzle
import { createAdminClient } from '@/lib/supabase/admin';
import {
  upsertConversation,
  insertMessage,
  findTenantByPhone,
  updateConversationActivity,
} from '@/lib/whatsapp/db';
import { classifyMessage } from '@/lib/whatsapp/classify';
import { emit } from '@/lib/events/emit';
import { registerAllHandlers } from '@/lib/events/handlers';
import { log } from '@/lib/log';
import { serverEnv } from '@/lib/env';

// Register event handlers on module load
registerAllHandlers();

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

  // Read raw body for signature validation
  const rawBody = Buffer.from(await request.arrayBuffer());

  // Signature validation (HMAC-SHA256, constant-time compare)
  const signature = request.headers.get('x-signature') ?? '';
  const secret = serverEnv.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) {
    // Secret not configured — return 503 in preview deployments
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

  // Parse payload
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON' } },
      { status: 400 }
    );
  }

  const parsed = InboundWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_PAYLOAD', message: 'Validation failed', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { provider_message_id, from, type, text, attachment_url, timestamp } = parsed.data;

  // Find the first org — Drizzle (AC1)
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(1);

  if (!orgRows.length) {
    log.error('[webhook] no organizations found');
    return NextResponse.json({ ok: true }); // Return 200 to prevent provider retry
  }

  const orgId = orgRows[0].id;

  // TODO(W6): replace adminClient with db once whatsapp/db lib functions are migrated to Drizzle
  const adminClient = createAdminClient();

  // Find tenant by phone (PII: do not log phone)
  const tenant = await findTenantByPhone(adminClient, orgId, from);

  // Upsert conversation
  const conversationId = await upsertConversation({
    adminClient,
    orgId,
    externalPhone: from,
    tenantId: tenant?.id ?? null,
  });

  // Classify message for intent detection
  const attachmentKind = ['image', 'document', 'audio', 'video'].includes(type) ? type : null;
  const classification = await classifyMessage(text ?? null, attachmentKind, orgId);

  // Insert message (idempotent on provider_message_id)
  const messageId = await insertMessage({
    adminClient,
    orgId,
    conversationId,
    direction: 'inbound',
    providerMessageId: provider_message_id,
    body: text ?? null,
    attachmentPath: null, // path set after download; attachment_url is provider URL
    attachmentKind: attachmentKind as 'image' | 'document' | 'audio' | 'video' | null,
    classification: classification.classification,
    status: 'received',
    meta: { from_provider: true, timestamp, attachment_url: attachment_url ?? null },
  });

  if (!messageId) {
    // Duplicate — already processed
    return NextResponse.json({ ok: true });
  }

  // Update conversation activity
  await updateConversationActivity(adminClient, conversationId, true);

  // Emit events (fire-and-forget)
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

  return NextResponse.json({ ok: true });
}
