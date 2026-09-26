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

/**
 * Hosts we're willing to redirect an authenticated admin to. `recordingUrl`
 * is stored verbatim from Vapi webhooks (see voice/webhook-handlers.ts) —
 * this route must not become an open redirect if that value is ever
 * corrupted or (post-compromise) attacker-controlled. Exact hosts and
 * `*.`-wildcard subdomains only; keep this the single list other reviewers
 * check when a new storage provider is added.
 */
const ALLOWED_RECORDING_HOSTS: readonly string[] = [
  'vapi.ai',
  '*.vapi.ai',
  'storage.vapi.ai',
  '*.amazonaws.com',
  '*.r2.cloudflarestorage.com',
];

function isAllowedRecordingHost(hostname: string): boolean {
  return ALLOWED_RECORDING_HOSTS.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // '.vapi.ai'
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === pattern;
  });
}

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

  let url: URL;
  try {
    url = new URL(call.recordingUrl);
  } catch {
    return notFound();
  }
  if (url.protocol !== 'https:' || !isAllowedRecordingHost(url.hostname)) return notFound();

  const response = NextResponse.redirect(url.toString(), 302);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}
