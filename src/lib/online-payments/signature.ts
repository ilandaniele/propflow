import crypto from 'crypto';

interface MercadoPagoSignatureInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}

function parseSignatureHeader(header: string): { ts: string | null; v1: string | null } {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim(), rest.join('=').trim()] as const;
    }),
  );
  return { ts: parts.get('ts') || null, v1: parts.get('v1') || null };
}

function normalizeDataId(dataId: string): string {
  return /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
}

export function mercadoPagoManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${normalizeDataId(dataId)};request-id:${requestId};ts:${ts};`;
}

export function verifyMercadoPagoSignature({ xSignature, xRequestId, dataId, secret }: MercadoPagoSignatureInput): boolean {
  if (!xSignature || !xRequestId || !dataId || !secret) return false;
  const { ts, v1 } = parseSignatureHeader(xSignature);
  if (!ts || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return false;

  const expected = crypto.createHmac('sha256', secret).update(mercadoPagoManifest(dataId, xRequestId, ts)).digest();
  const received = Buffer.from(v1, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
