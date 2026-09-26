/**
 * Thin fetch wrapper around Vapi's REST API — outbound-only (`POST /call`).
 * No SDK dependency: `fetch` + `AbortSignal.timeout`, matching the rest of
 * this codebase's provider clients (e.g. src/lib/whatsapp/provider.ts).
 *
 * Body shape verified against handoffs/vapi-notes.md (research agent, Phase
 * 8-9): `POST https://api.vapi.ai/call` with `phoneNumberId`,
 * `customer: { number }`, `assistant` (transient assistant object, same
 * shape assistant.ts's buildVapiAssistant/buildRefusalAssistant produce) and
 * `metadata`. Response is a `Call` object (`id`, `status`, ...) on 201.
 */

import { log } from '@/lib/log';
import type { VapiAssistant } from './vapi-types';

const VAPI_API_BASE = 'https://api.vapi.ai';
const REQUEST_TIMEOUT_MS = 10_000;

export class VapiApiError extends Error {
  constructor(public status: number, msg?: string) {
    super(msg ?? `Vapi API error (status ${status})`);
    this.name = 'VapiApiError';
  }
}

export interface CreateVapiCallArgs {
  phoneNumberId: string;
  customerNumber: string;
  assistant: VapiAssistant;
  metadata: Record<string, string>;
}

export interface CreateVapiCallResult {
  id: string;
  status: string;
}

/**
 * POST /call. Never logs `customerNumber` (PII) — only the resulting call id
 * and, on failure, the HTTP status.
 */
export async function createVapiCall(a: CreateVapiCallArgs): Promise<CreateVapiCallResult> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new VapiApiError(500, 'VAPI_API_KEY not configured');

  let res: Response;
  try {
    res = await fetch(`${VAPI_API_BASE}/call`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId: a.phoneNumberId,
        customer: { number: a.customerNumber },
        assistant: a.assistant,
        metadata: a.metadata,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network failure or AbortSignal.timeout firing — treated like a 5xx by
    // the caller (outbound.ts's runOutboundCallJob): back to queued, retry.
    log.warn('[voice/vapi-client] createVapiCall network/timeout error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    throw new VapiApiError(0, 'network_or_timeout');
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // No/invalid JSON body — fall through, res.ok still drives the outcome below.
  }

  if (!res.ok) {
    log.warn('[voice/vapi-client] createVapiCall non-2xx', { status: res.status });
    throw new VapiApiError(res.status, `Vapi call create failed (status ${res.status})`);
  }

  const parsed = (body ?? {}) as { id?: string; status?: string };
  if (!parsed.id) throw new VapiApiError(res.status, 'Vapi response missing call id');

  return { id: parsed.id, status: parsed.status ?? 'queued' };
}
