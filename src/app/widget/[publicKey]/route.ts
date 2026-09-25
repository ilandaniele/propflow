export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWebChannel } from '@/lib/widget/channel';
import { buildFrameAncestors } from '@/lib/widget/origins';
import { renderWidgetFrame } from '@/lib/widget/frame-html';

const NOT_FOUND_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title></head><body></body></html>';

function notFound(): NextResponse {
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

/**
 * GET /widget/[publicKey] — the iframe's own document (§4). Runs on the app
 * origin, NOT bypassed by src/proxy.ts's default security headers (see the
 * `/widget/*` exemption there) — this route sets its own CSP, including a
 * per-org frame-ancestors, and intentionally sends no X-Frame-Options.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicKey: string }> },
): Promise<NextResponse> {
  const { publicKey } = await params;
  const channel = await resolveWebChannel(publicKey);
  if (!channel || !channel.enabled) return notFound();

  const ref = request.nextUrl.searchParams.get('ref');
  const initialListingRef = ref && ref.length > 0 ? ref.slice(0, 80) : null;

  const nonce = randomUUID().replace(/-/g, '');
  const html = renderWidgetFrame({
    nonce,
    publicKey: channel.publicKey,
    orgName: channel.orgName,
    greeting: channel.greeting,
    accentColor: channel.accentColor,
    allowedOrigins: channel.allowedOrigins,
    initialListingRef,
  });

  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' https: data:",
    "base-uri 'none'",
    "form-action 'none'",
    buildFrameAncestors(channel.allowedOrigins),
  ].join('; ');

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
