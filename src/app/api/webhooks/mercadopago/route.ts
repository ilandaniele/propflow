export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, publicAssetRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { mercadoPagoCredentials } from '@/lib/online-payments/provider';
import { verifyMercadoPagoSignature } from '@/lib/online-payments/signature';
import { reconcileMercadoPagoPayment } from '@/lib/online-payments/settle';

function readNotification(request: NextRequest, body: unknown): { type: string | null; dataId: string | null } {
  const payload = (body && typeof body === 'object' ? body : {}) as { type?: unknown; data?: { id?: unknown } };
  const query = request.nextUrl.searchParams;
  const bodyId = payload.data?.id;
  return {
    type: query.get('type') ?? (typeof payload.type === 'string' ? payload.type : null),
    dataId: query.get('data.id') ?? (typeof bodyId === 'string' || typeof bodyId === 'number' ? String(bodyId) : null),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!publicAssetRateLimit(getClientIp(request)).success) return new NextResponse(null, { status: 429 });

  const credentials = mercadoPagoCredentials();
  if (!credentials) return new NextResponse(null, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  const { type, dataId } = readNotification(request, body);

  const validSignature = verifyMercadoPagoSignature({
    xSignature: request.headers.get('x-signature'),
    xRequestId: request.headers.get('x-request-id'),
    dataId,
    secret: credentials.webhookSecret,
  });
  if (!validSignature || !dataId) return new NextResponse(null, { status: 401 });
  if (type !== 'payment') return new NextResponse(null, { status: 200 });

  try {
    const outcome = await reconcileMercadoPagoPayment(dataId, credentials.accessToken);
    log.info('[mercadopago webhook] processed', { outcome, paymentId: dataId });
  } catch (e) {
    log.error('[mercadopago webhook] reconcile failed', { code: e instanceof Error ? e.message : String(e), paymentId: dataId });
    return new NextResponse(null, { status: 502 });
  }
  return new NextResponse(null, { status: 200 });
}
