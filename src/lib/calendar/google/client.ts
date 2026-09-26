/**
 * Minimal fetch wrapper for the Google Calendar v3 REST API. No `googleapis`
 * dependency (blueprint assumption 2) — every call in events.ts / freebusy.ts
 * goes through googleFetch(), which owns access-token refresh and the
 * single 401 retry.
 */

import { getValidAccessToken } from '../connections';
import { GoogleApiError } from '../types';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_TIMEOUT_MS = 8000;

export interface GoogleFetchInit {
  method?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function doFetch(url: string, method: string, accessToken: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function extractErrorReason(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    // Never log the raw body (may carry account-identifying detail from Google) — reason code only.
    return json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * base https://www.googleapis.com/calendar/v3; one retry on 401 after a
 * forced token refresh; non-2xx -> GoogleApiError(status, reason).
 */
export async function googleFetch<T>(connectionId: string, path: string, init: GoogleFetchInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const url = buildUrl(path, init.query);
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let accessToken = await getValidAccessToken(connectionId);
  let res = await doFetch(url, method, accessToken, init.body, timeoutMs);

  if (res.status === 401) {
    accessToken = await getValidAccessToken(connectionId, { forceRefresh: true });
    res = await doFetch(url, method, accessToken, init.body, timeoutMs);
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const reason = await extractErrorReason(res);
    throw new GoogleApiError(res.status, reason);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
