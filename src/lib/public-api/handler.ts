import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sha256 } from '@/lib/crypto/hash';
import { parseBearerToken } from '@/lib/api-keys/token';
import { claimActiveApiKey } from '@/lib/api-keys/queries';
import { actionRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { ApiPageSchema, toPage, type ApiPage } from './pagination';

const API_KEY_REQUESTS_PER_MINUTE = 120;

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type ApiKeyAuth = { ok: true; orgId: string } | { ok: false; response: NextResponse };

export async function authenticateApiKey(request: NextRequest): Promise<ApiKeyAuth> {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) return { ok: false, response: apiError(401, 'UNAUTHORIZED', 'Missing or invalid API key') };

  const key = await claimActiveApiKey(sha256(token));
  if (!key) return { ok: false, response: apiError(401, 'UNAUTHORIZED', 'Missing or invalid API key') };

  if (!actionRateLimit(`api-key:${key.id}`, API_KEY_REQUESTS_PER_MINUTE, 60_000).success) {
    return { ok: false, response: apiError(429, 'RATE_LIMITED', 'Too many requests') };
  }
  return { ok: true, orgId: key.orgId };
}

export function publicApiRoute<S extends z.ZodObject, T>(
  name: string,
  filterSchema: S,
  fetchRows: (orgId: string, page: ApiPage, filters: z.infer<S>) => Promise<T[]>,
) {
  return async function GET(request: NextRequest) {
    try {
      const auth = await authenticateApiKey(request);
      if (!auth.ok) return auth.response;

      const params = Object.fromEntries(request.nextUrl.searchParams);
      const page = ApiPageSchema.safeParse(params);
      const filters = filterSchema.safeParse(params);
      if (!page.success || !filters.success) return apiError(400, 'VALIDATION_ERROR', 'Invalid query parameters');

      const rows = await fetchRows(auth.orgId, page.data, filters.data);
      return NextResponse.json(toPage(rows, page.data), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      log.error('public_api.failed', { endpoint: name, error: error instanceof Error ? error.message : String(error) });
      return apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  };
}
