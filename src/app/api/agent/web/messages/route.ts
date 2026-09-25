export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { z } from 'zod/v4';
import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/log';
import { getClientIp } from '@/lib/ratelimit';
import { isSameAppOrigin } from '@/lib/widget/origins';
import { resolveWebChannel } from '@/lib/widget/channel';
import { authenticateWebSession, listWebTranscript } from '@/lib/widget/web-session';
import { handleWebMessage } from '@/lib/widget/web-turn';
import type { WebApiError } from '@/lib/agent/types';

const PostBodySchema = z.object({
  publicKey: z.string().min(1).max(80),
  text: z.string().trim().min(1).max(1000),
  listingRef: z.string().max(80).nullable().optional(),
  pageUrl: z.string().max(500).nullable().optional(),
});

function errorResponse(status: number, error: WebApiError['error']): NextResponse {
  return NextResponse.json({ error }, { status });
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** GET /api/agent/web/messages?publicKey= — Bearer-authenticated transcript replay for a reopened widget. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSameAppOrigin(request)) {
    return errorResponse(403, { code: 'FORBIDDEN_ORIGIN', message: 'Origen no permitido.' });
  }

  const publicKey = request.nextUrl.searchParams.get('publicKey') ?? '';
  const channel = await resolveWebChannel(publicKey);
  if (!channel || !channel.enabled) {
    return errorResponse(404, { code: 'NOT_FOUND', message: 'Chat no disponible.' });
  }

  const token = bearerToken(request);
  const session = token ? await authenticateWebSession(channel.orgId, token) : null;
  if (!session) {
    return errorResponse(401, { code: 'SESSION', message: 'Sesión inválida o vencida.' });
  }

  if (!session.agentSessionId) {
    return NextResponse.json({ messages: [] });
  }

  const messages = await listWebTranscript(channel.orgId, session.agentSessionId);
  return NextResponse.json({ messages });
}

/** POST /api/agent/web/messages — one turn of the widget chat (§4, delegates to handleWebMessage). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameAppOrigin(request)) {
    return errorResponse(403, { code: 'FORBIDDEN_ORIGIN', message: 'Origen no permitido.' });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, { code: 'VALIDATION', message: 'JSON inválido.' });
  }
  const parsed = PostBodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, { code: 'VALIDATION', message: 'Datos inválidos.' });
  }

  const channel = await resolveWebChannel(parsed.data.publicKey);
  if (!channel || !channel.enabled) {
    return errorResponse(404, { code: 'NOT_FOUND', message: 'Chat no disponible.' });
  }

  const token = bearerToken(request);
  const session = token ? await authenticateWebSession(channel.orgId, token) : null;
  if (!session) {
    return errorResponse(401, { code: 'SESSION', message: 'Sesión inválida o vencida.' });
  }

  try {
    const { status, body } = await handleWebMessage({
      channel,
      session,
      text: parsed.data.text,
      listingRef: parsed.data.listingRef ?? null,
      pageUrl: parsed.data.pageUrl ?? null,
      ip: getClientIp(request),
    });
    return NextResponse.json(body, { status });
  } catch (err) {
    // Never log message text, phone numbers, IPs or tokens (§6 pitfalls).
    log.error('[api/agent/web/messages] handleWebMessage failed', { error: err instanceof Error ? err.message : 'unknown' });
    return errorResponse(500, { code: 'VALIDATION', message: 'No pudimos procesar tu mensaje. Probá de nuevo.' });
  }
}
