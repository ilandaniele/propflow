/**
 * Unit tests for MetaWhatsAppProvider.
 *
 * All network calls are stubbed via vi.spyOn(globalThis, 'fetch').
 * Backoff delays use vi.useFakeTimers() so the suite stays fast.
 * No PII (access token, phone numbers, message bodies) appears in any assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaWhatsAppProvider, ValidationError } from '@/lib/whatsapp/meta-provider';

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------
const TEST_ENV = {
  WHATSAPP_ACCESS_TOKEN:         'test-access-token-xxx',
  WHATSAPP_PHONE_NUMBER_ID:      '12345678901',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token-xxx',
  META_APP_SECRET:               'app-secret-xxx',
};

function setEnv() {
  Object.assign(process.env, TEST_ENV);
}
function clearEnv() {
  for (const k of Object.keys(TEST_ENV)) delete process.env[k];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOkResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// sendMessage — text message
// ---------------------------------------------------------------------------
describe('MetaWhatsAppProvider.sendMessage', () => {
  let provider: MetaWhatsAppProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setEnv();
    vi.useFakeTimers();
    provider = new MetaWhatsAppProvider();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearEnv();
  });

  it('success path: returns ok=true with providerMessageId', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ messages: [{ id: 'wamid.HBgLMTU1NTU1NTU1NQ==.test' }] })
    );

    const resultPromise = provider.sendMessage('org-1', {
      to:   '+5491155555555',
      body: 'Test message',
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.HBgLMTU1NTU1NTU1NQ==.test');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify the Authorization header contains Bearer but NOT the raw token value in assertion
    const [, init] = fetchSpy.mock.calls[0];
    const authHeader = (init as RequestInit).headers as Record<string, string>;
    expect(authHeader['Authorization']).toBe(`Bearer ${TEST_ENV.WHATSAPP_ACCESS_TOKEN}`);
  });

  it('retry on 503: retries up to 3 times, returns ok=true on 3rd attempt', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeErrorResponse(503, { error: { code: 131056 } }))
      .mockResolvedValueOnce(makeErrorResponse(503, { error: { code: 131056 } }))
      .mockResolvedValueOnce(makeOkResponse({ messages: [{ id: 'wamid.retry-success' }] }));

    const resultPromise = provider.sendMessage('org-1', { to: '+1234567890', body: 'retry test' });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.retry-success');
  });

  it('retry on 429: retries and succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeErrorResponse(429, {}))
      .mockResolvedValueOnce(makeOkResponse({ messages: [{ id: 'wamid.after-429' }] }));

    const resultPromise = provider.sendMessage('org-1', { to: '+1234567890', body: 'rate limited' });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('no retry on 400: fetch called exactly once, returns ok=false', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeErrorResponse(400, { error: { code: 100, message: 'Invalid parameter' } })
    );

    const resultPromise = provider.sendMessage('org-1', { to: '+1234567890', body: 'bad request' });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    // errorCode should reflect Meta error code 100 — no stack trace or message leaked
    expect(result.error).toBe('META_100');
  });

  it('exhausted retries: 4 calls (attempt 0-3) all 503 → ok=false with META_HTTP_503', async () => {
    // The retry loop runs attempt 0..RETRY_DELAYS_MS.length (0..3), making 4 fetch calls total.
    // Provide 4 mocked 503 responses so fetch never falls through to a real network call.
    fetchSpy
      .mockResolvedValueOnce(makeErrorResponse(503, {}))
      .mockResolvedValueOnce(makeErrorResponse(503, {}))
      .mockResolvedValueOnce(makeErrorResponse(503, {}))
      .mockResolvedValueOnce(makeErrorResponse(503, {}));

    const resultPromise = provider.sendMessage('org-1', { to: '+1234567890', body: 'unavailable' });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/META_HTTP_503/);
  });
});

// ---------------------------------------------------------------------------
// sendInteractiveButtons — validation
// ---------------------------------------------------------------------------
describe('MetaWhatsAppProvider.sendInteractiveButtons', () => {
  let provider: MetaWhatsAppProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setEnv();
    vi.useFakeTimers();
    provider = new MetaWhatsAppProvider();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearEnv();
  });

  it('throws ValidationError for >3 buttons — fetch NOT called', async () => {
    await expect(
      provider.sendInteractiveButtons('org-1', {
        to: '+1234567890',
        bodyText: 'Choose',
        buttons: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' },
        ],
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws ValidationError for button title >20 chars — fetch NOT called', async () => {
    await expect(
      provider.sendInteractiveButtons('org-1', {
        to: '+1234567890',
        bodyText: 'Choose',
        buttons: [{ id: 'btn1', title: 'a'.repeat(21) }],
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws ValidationError for duplicate button IDs — fetch NOT called', async () => {
    await expect(
      provider.sendInteractiveButtons('org-1', {
        to: '+1234567890',
        bodyText: 'Choose',
        buttons: [
          { id: 'same-id', title: 'Button A' },
          { id: 'same-id', title: 'Button B' },
        ],
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('success path: sends request with type=interactive and interactive.type=button', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ messages: [{ id: 'wamid.interactive-ok' }] })
    );

    const resultPromise = provider.sendInteractiveButtons('org-1', {
      to: '+1234567890',
      bodyText: 'Pick one',
      buttons: [
        { id: 'task:uuid:listo',    title: 'Listo' },
        { id: 'task:uuid:no_puedo', title: 'No puedo hoy' },
      ],
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.interactive-ok');

    // Verify the payload shape
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.action.buttons).toHaveLength(2);
    expect(body.interactive.action.buttons[0].type).toBe('reply');
  });
});

// ---------------------------------------------------------------------------
// validateWebhookSignature
// ---------------------------------------------------------------------------
describe('MetaWhatsAppProvider.validateWebhookSignature', () => {
  let provider: MetaWhatsAppProvider;

  beforeEach(() => {
    setEnv();
    provider = new MetaWhatsAppProvider();
  });

  afterEach(() => {
    clearEnv();
  });

  it('returns true for a valid HMAC-SHA256 signature', () => {
    const crypto = require('crypto');
    const body   = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = TEST_ENV.META_APP_SECRET;
    const hex    = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sig    = `sha256=${hex}`;

    expect(provider.validateWebhookSignature(body, sig)).toBe(true);
  });

  it('returns false when body has been tampered', () => {
    const crypto  = require('crypto');
    const original = Buffer.from('{"object":"whatsapp_business_account"}');
    const tampered = Buffer.from('{"object":"TAMPERED"}');
    const secret  = TEST_ENV.META_APP_SECRET;
    const hex     = crypto.createHmac('sha256', secret).update(original).digest('hex');
    const sig     = `sha256=${hex}`;

    expect(provider.validateWebhookSignature(tampered, sig)).toBe(false);
  });

  it('returns false when META_APP_SECRET is missing', () => {
    delete process.env.META_APP_SECRET;
    const result = provider.validateWebhookSignature(Buffer.from('body'), 'sha256=abc');
    expect(result).toBe(false);
  });

  it('returns false when signature has wrong prefix (not sha256=)', () => {
    const body = Buffer.from('body');
    expect(provider.validateWebhookSignature(body, 'md5=somehex')).toBe(false);
    expect(provider.validateWebhookSignature(body, 'invalidsignature')).toBe(false);
  });
});
