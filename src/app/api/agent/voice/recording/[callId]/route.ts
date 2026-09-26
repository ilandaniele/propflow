export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/agent/voice/recording/[callId] — Phase 8-9, item E.
 *
 * admin-only, org-scoped redirect to the Vapi recording URL. Vapi recording
 * links are themselves bearer links (blueprint §11) — this route doesn't
 * sign anything, it just keeps the URL behind an authenticated, org-scoped
 * gate instead of pasting it into rendered HTML, and forbids caching.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentCalls } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> },
): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return notFound();
  }

  const { callId } = await params;
  if (!z.string().uuid().safeParse(callId).success) return notFound();

  const rows = await db
    .select({ recordingUrl: agentCalls.recordingUrl })
    .from(agentCalls)
    .where(and(eq(agentCalls.id, callId), eq(agentCalls.orgId, ctx.orgId)))
    .limit(1);
  const call = rows[0];
  if (!call || !call.recordingUrl) return notFound();

  const response = NextResponse.redirect(call.recordingUrl, 302);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}
