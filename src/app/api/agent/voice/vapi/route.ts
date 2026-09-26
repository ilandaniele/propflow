/**
 * POST /api/agent/voice/vapi — the only Server URL Vapi is configured with
 * (assistant-request, tool-calls, status-update, end-of-call-report; see
 * handoffs/vapi-notes.md and blueprint §3). No session — authenticated by a
 * shared secret instead (X-Vapi-Secret, or Authorization: Bearer, both
 * timing-safe-compared).
 *
 * Never logs a transcript, phone number, recording URL or tool argument.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/log';
import { VapiWebhookBodySchema, type VapiServerMessage } from '@/lib/agent/voice/vapi-types';
import { handleAssistantRequest, handleStatusUpdate, handleToolCalls } from '@/lib/agent/voice/webhook-handlers';
import { handleEndOfCallReport } from '@/lib/agent/voice/call-report';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB (blueprint §3)

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on mismatched lengths — comparing against a
  // same-length buffer first keeps the whole check constant-time-ish without
  // ever branching on the *content* of the secret.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return false;

  const headerSecret = request.headers.get('x-vapi-secret');
  if (headerSecret && safeEqualStrings(headerSecret, secret)) return true;

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    if (safeEqualStrings(token, secret)) return true;
  }

  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const startedAtMs = Date.now();

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Payload too large' } }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Invalid JSON' } }, { status: 400 });
  }

  const parsed = VapiWebhookBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Invalid payload' } }, { status: 400 });
  }

  const message: VapiServerMessage = parsed.data.message;

  try {
    switch (message.type) {
      case 'assistant-request':
        return NextResponse.json(await handleAssistantRequest(message));
      case 'tool-calls':
        return NextResponse.json(await handleToolCalls(message, startedAtMs));
      case 'status-update':
        await handleStatusUpdate(message);
        return NextResponse.json({});
      case 'end-of-call-report':
        await handleEndOfCallReport(message);
        return NextResponse.json({});
      default:
        // Unknown/future event types are a no-op 200, never an error (§3).
        return NextResponse.json({});
    }
  } catch (err) {
    log.error('[api/agent/voice/vapi] handler failed', { type: message.type, error: err instanceof Error ? err.message : 'unknown' });
    // §3: tool-calls must ALWAYS answer 200 — an empty results array is the
    // safest fallback when we can't even resolve the toolCallIds to answer per-call.
    if (message.type === 'tool-calls') {
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 });
  }
}
