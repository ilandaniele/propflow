export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { z } from 'zod/v4';
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, webSessionCreateRateLimit } from '@/lib/ratelimit';
import { isSameAppOrigin } from '@/lib/widget/origins';
import { resolveWebChannel } from '@/lib/widget/channel';
import { createWebSession, hashIp } from '@/lib/widget/web-session';
import { incrementWebUsage } from '@/lib/widget/usage';
import type { WebApiError } from '@/lib/agent/types';

const BodySchema = z.object({
  publicKey: z.string().min(1).max(80),
  pageUrl: z.url().max(500).optional(),
  listingRef: z.string().max(80).optional(),
});

function errorResponse(status: number, error: WebApiError['error']): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * POST /api/agent/web/session — creates the widget's opaque session
 * identity (§4). Same-origin only (the iframe is the only caller); the
 * cross-origin surface is /widget.js.
 */
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
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, { code: 'VALIDATION', message: 'Datos inválidos.' });
  }

  const ip = getClientIp(request);
  const rate = webSessionCreateRateLimit(ip);
  if (!rate.success) {
    return errorResponse(429, { code: 'RATE_LIMITED', message: 'Demasiados intentos, esperá un momento.', retryAfterMs: rate.retryAfterMs });
  }

  const channel = await resolveWebChannel(parsed.data.publicKey);
  if (!channel || !channel.enabled) {
    return errorResponse(404, { code: 'NOT_FOUND', message: 'Chat no disponible.' });
  }

  const usage = await incrementWebUsage(channel.orgId, 'sessions', channel.dailySessionCap);
  if (!usage.allowed) {
    return errorResponse(503, { code: 'DAILY_CAP', message: 'Llegamos al límite de chats de hoy para este sitio.' });
  }

  const { session, token } = await createWebSession({
    orgId: channel.orgId,
    ipHash: hashIp(ip),
    origin: request.headers.get('origin'),
    pageUrl: parsed.data.pageUrl ?? null,
  });

  return NextResponse.json(
    {
      token,
      expiresAt: session.expiresAt.toISOString(),
      greeting: channel.greeting,
      orgName: channel.orgName,
      whatsappAvailable: channel.whatsappDisplayPhone != null,
    },
    { status: 201 },
  );
}
