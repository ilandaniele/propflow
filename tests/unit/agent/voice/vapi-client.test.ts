import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createVapiCall, VapiApiError } from '@/lib/agent/voice/vapi-client';
import type { VapiAssistant } from '@/lib/agent/voice/vapi-types';

const ASSISTANT = { firstMessage: 'hola' } as unknown as VapiAssistant;

describe('agent/voice/vapi-client — createVapiCall', () => {
  const originalKey = process.env.VAPI_API_KEY;

  beforeEach(() => {
    process.env.VAPI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.VAPI_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('sends a Bearer auth header and the phoneNumberId/customer/assistant/metadata body to POST /call', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'call-1', status: 'queued' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createVapiCall({
      phoneNumberId: 'pn-1',
      customerNumber: '+51999888777',
      assistant: ASSISTANT,
      metadata: { orgId: 'org-1', agentCallId: 'call-1' },
    });

    expect(result).toEqual({ id: 'call-1', status: 'queued' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.vapi.ai/call');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      phoneNumberId: 'pn-1',
      customer: { number: '+51999888777' },
      assistant: ASSISTANT,
      metadata: { orgId: 'org-1', agentCallId: 'call-1' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws VapiApiError with the response status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad request' }), { status: 400 })));

    await expect(
      createVapiCall({ phoneNumberId: 'pn-1', customerNumber: '+51999888777', assistant: ASSISTANT, metadata: {} }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws VapiApiError with status 0 on a network/timeout failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError');
    }));

    const err = await createVapiCall({ phoneNumberId: 'pn-1', customerNumber: '+51999888777', assistant: ASSISTANT, metadata: {} }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(VapiApiError);
    expect((err as InstanceType<typeof VapiApiError>).status).toBe(0);
  });

  it('throws (500, config error) when VAPI_API_KEY is not configured', async () => {
    delete process.env.VAPI_API_KEY;
    vi.stubGlobal('fetch', vi.fn());

    await expect(
      createVapiCall({ phoneNumberId: 'pn-1', customerNumber: '+51999888777', assistant: ASSISTANT, metadata: {} }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
