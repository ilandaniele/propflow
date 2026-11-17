import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({
  assertServerEnv: (key: string) => {
    if (key === 'RESEND_API_KEY') return 're_test_key';
    if (key === 'RESEND_FROM_EMAIL') return 'PropFlow <noreply@example.com>';
    throw new Error(`unexpected env ${key}`);
  },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { sendEmail } from '@/lib/notifications/email';

const message = { to: 'tenant@example.com', subject: 'Hi', html: '<p>Hi</p>', context: 'test' };

describe('sendEmail (Resend REST)', () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts JSON with bearer auth to the Resend emails endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));

    const result = await sendEmail(message);

    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'PropFlow <noreply@example.com>',
      to: 'tenant@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });
  });

  it('returns the Resend error name on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: 'validation_error', message: 'bad' }), { status: 422 }),
    );

    expect(await sendEmail(message)).toEqual({ success: false, error: 'validation_error' });
  });

  it('falls back to application_error when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('upstream down', { status: 502 }));

    expect(await sendEmail(message)).toEqual({ success: false, error: 'application_error' });
  });

  it('fails closed when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(await sendEmail(message)).toEqual({ success: false, error: 'send_exception' });
  });
});
