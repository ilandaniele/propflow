import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { mercadoPagoManifest, verifyMercadoPagoSignature } from '@/lib/online-payments/signature';

const SECRET = 'test-webhook-secret';
const REQUEST_ID = 'req-123';
const TS = '1742505638683';

function sign(dataId: string, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(mercadoPagoManifest(dataId, REQUEST_ID, TS)).digest('hex');
}

function input(overrides: Partial<Parameters<typeof verifyMercadoPagoSignature>[0]> = {}) {
  return { xSignature: `ts=${TS},v1=${sign('123456')}`, xRequestId: REQUEST_ID, dataId: '123456', secret: SECRET, ...overrides };
}

describe('verifyMercadoPagoSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyMercadoPagoSignature(input())).toBe(true);
  });

  it('builds the manifest in the documented format', () => {
    expect(mercadoPagoManifest('123456', REQUEST_ID, TS)).toBe(`id:123456;request-id:${REQUEST_ID};ts:${TS};`);
  });

  it('tolerates spaces around signature parts', () => {
    expect(verifyMercadoPagoSignature(input({ xSignature: `ts=${TS}, v1=${sign('123456')}` }))).toBe(true);
  });

  it('lowercases alphanumeric data ids before signing', () => {
    const xSignature = `ts=${TS},v1=${sign('abc123')}`;
    expect(verifyMercadoPagoSignature(input({ xSignature, dataId: 'ABC123' }))).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifyMercadoPagoSignature(input({ xSignature: `ts=${TS},v1=${sign('123456', 'other')}` }))).toBe(false);
  });

  it('rejects a signature for another data id', () => {
    expect(verifyMercadoPagoSignature(input({ dataId: '999' }))).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    expect(verifyMercadoPagoSignature(input({ xSignature: `ts=1,v1=${sign('123456')}` }))).toBe(false);
  });

  it('rejects malformed v1 values', () => {
    expect(verifyMercadoPagoSignature(input({ xSignature: `ts=${TS},v1=abc` }))).toBe(false);
    expect(verifyMercadoPagoSignature(input({ xSignature: `ts=${TS},v1=${'z'.repeat(64)}` }))).toBe(false);
  });

  it.each([
    ['x-signature header', { xSignature: null }],
    ['x-request-id header', { xRequestId: null }],
    ['data id', { dataId: null }],
    ['secret', { secret: '' }],
    ['ts part', { xSignature: `v1=${sign('123456')}` }],
    ['v1 part', { xSignature: `ts=${TS}` }],
  ])('rejects when the %s is missing', (_label, overrides) => {
    expect(verifyMercadoPagoSignature(input(overrides))).toBe(false);
  });
});
