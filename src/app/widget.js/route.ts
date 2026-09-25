export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAppOrigin } from '@/lib/widget/origins';
import { buildLoaderScript } from '@/lib/widget/loader-script';

/**
 * GET /widget.js — the only widget asset that's cross-origin by design
 * (embedded by third-party host pages). CORS-open, cacheable, no cookies
 * (Access-Control-Allow-Origin: * — never combined with credentials).
 */
export async function GET(): Promise<NextResponse> {
  const body = buildLoaderScript(getAppOrigin());

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
