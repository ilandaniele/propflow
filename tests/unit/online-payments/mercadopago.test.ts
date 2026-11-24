import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildPreferencePayload, createMercadoPagoAdapter, fetchMercadoPagoPayment } from '@/lib/online-payments/mercadopago';
import { matchPaymentToIntent } from '@/lib/online-payments/payment-match';

const SITE = 'https://app.example.test';
const TOKEN = 'a'.repeat(64);
const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const CHECKOUT_INPUT = {
  intentId: INTENT_ID,
  chargeId: '22222222-2222-4222-8222-222222222222',
  token: TOKEN,
  title: 'Alquiler noviembre',
  amount: '800.50',
  currency: 'PEN',
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildPreferencePayload', () => {
  it('builds a Checkout Pro preference tied to the intent', () => {
    expect(buildPreferencePayload(CHECKOUT_INPUT, SITE)).toEqual({
      items: [{ id: CHECKOUT_INPUT.chargeId, title: 'Alquiler noviembre', quantity: 1, unit_price: 800.5, currency_id: 'PEN' }],
      external_reference: INTENT_ID,
      notification_url: `${SITE}/api/webhooks/mercadopago`,
      back_urls: { success: `${SITE}/pay/${TOKEN}`, pending: `${SITE}/pay/${TOKEN}`, failure: `${SITE}/pay/${TOKEN}` },
      auto_return: 'approved',
      expires: true,
      expiration_date_to: '2026-12-01T00:00:00.000Z',
    });
  });
});

describe('Mercado Pago HTTP client (stubbed fetch)', () => {
  it('POSTs the preference with a bearer token and returns init_point', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'pref_1', init_point: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMercadoPagoAdapter('TEST-token', SITE).createCheckout(CHECKOUT_INPUT);

    expect(result).toEqual({ providerRef: 'pref_1', checkoutUrl: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer TEST-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body).external_reference).toBe(INTENT_ID);
  });

  it('rejects a non-https checkout url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'pref_1', init_point: 'http://evil.test' })));
    await expect(createMercadoPagoAdapter('TEST-token', SITE).createCheckout(CHECKOUT_INPUT)).rejects.toThrow();
  });

  it('throws without leaking the access token on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const error = await fetchMercadoPagoPayment('123', 'TEST-secret-token').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('TEST-secret-token');
  });

  it('fetches a payment by id and normalizes the numeric id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 123, status: 'approved', external_reference: INTENT_ID, transaction_amount: 800.5, currency_id: 'PEN' }));
    vi.stubGlobal('fetch', fetchMock);
    const payment = await fetchMercadoPagoPayment('123', 'TEST-token');
    expect(payment.id).toBe('123');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/v1/payments/123');
  });
});

describe('matchPaymentToIntent', () => {
  const intent = { id: INTENT_ID, amount: '800.50', currency: 'PEN' };
  const payment = { id: '1', status: 'approved', external_reference: INTENT_ID, transaction_amount: 800.5, currency_id: 'PEN' };

  it('accepts an approved payment with matching reference and amount', () => {
    expect(matchPaymentToIntent(payment, intent)).toBe('ok');
  });

  it('rejects an amount mismatch', () => {
    expect(matchPaymentToIntent({ ...payment, transaction_amount: 800.49 }, intent)).toBe('amount_mismatch');
    expect(matchPaymentToIntent({ ...payment, transaction_amount: 1 }, intent)).toBe('amount_mismatch');
  });

  it('rejects a currency mismatch', () => {
    expect(matchPaymentToIntent({ ...payment, currency_id: 'USD' }, intent)).toBe('amount_mismatch');
  });

  it('rejects a payment that is not approved', () => {
    expect(matchPaymentToIntent({ ...payment, status: 'pending' }, intent)).toBe('not_approved');
  });

  it('rejects a payment for another intent', () => {
    expect(matchPaymentToIntent({ ...payment, external_reference: 'other' }, intent)).toBe('reference_mismatch');
  });
});
