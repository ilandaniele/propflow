export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, publicAssetRateLimit } from '@/lib/ratelimit';
import { isPayToken, payLinkPath } from '@/lib/online-payments/token';
import { simulateSandboxPayment } from '@/lib/online-payments/settle';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  if (!publicAssetRateLimit(getClientIp(request)).success) return new NextResponse(null, { status: 429 });

  const { token } = await params;
  if (!isPayToken(token)) return new NextResponse(null, { status: 404 });

  const outcome = await simulateSandboxPayment(token);
  if (outcome === 'not_found') return new NextResponse(null, { status: 404 });
  if (outcome === 'not_sandbox' || outcome === 'not_payable') return new NextResponse(null, { status: 409 });

  return NextResponse.redirect(new URL(payLinkPath(token), request.url), 303);
}
