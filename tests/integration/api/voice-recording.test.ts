/**
 * Integration tests for GET /api/agent/voice/recording/[callId] (Phase 8-9,
 * item E). Covers:
 *   - a call belonging to a different org -> 404 (IDOR guard)
 *   - not authenticated -> 404 (no detail leaked)
 *   - a call with no recording_url -> 404
 *   - happy path -> 302 + Cache-Control: no-store
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';
const CALL_ID = '550e8400-e29b-41d4-a716-446655440002';

let requireAdminImpl: () => Promise<{ orgId: string }>;

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminImpl(...(a as [])),
}));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['select', 'from', 'where', 'limit']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

let selectQueue: unknown[][] = [];
const mockSelect = vi.fn(() => makeChain(selectQueue.shift() ?? []));

vi.mock('@/lib/db', () => ({
  db: { select: (...a: unknown[]) => mockSelect(...a) },
}));

import { GET } from '@/app/api/agent/voice/recording/[callId]/route';

function callParams(callId = CALL_ID) {
  return { params: Promise.resolve({ callId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  requireAdminImpl = async () => ({ orgId: ORG_ID });
});

describe('GET /api/agent/voice/recording/[callId]', () => {
  it('not authenticated -> 404, no detail leaked', async () => {
    requireAdminImpl = async () => { throw new Error('UNAUTHORIZED'); };
    const res = await GET(new Request('http://localhost/x'), callParams());
    expect(res.status).toBe(404);
  });

  it('a call from a foreign org -> 404 (the where clause never matched, so the row is empty)', async () => {
    selectQueue.push([]); // simulates org_id mismatch: no row returned
    const res = await GET(new Request('http://localhost/x'), callParams());
    expect(res.status).toBe(404);
  });

  it('an invalid callId (not a uuid) -> 404 without touching the db', async () => {
    const res = await GET(new Request('http://localhost/x'), callParams('not-a-uuid'));
    expect(res.status).toBe(404);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('a call with no recording_url -> 404', async () => {
    selectQueue.push([{ recordingUrl: null }]);
    const res = await GET(new Request('http://localhost/x'), callParams());
    expect(res.status).toBe(404);
  });

  it('happy path -> 302 redirect with Cache-Control: no-store', async () => {
    selectQueue.push([{ recordingUrl: 'https://vapi.example/recordings/abc.mp3' }]);
    const res = await GET(new Request('http://localhost/x'), callParams());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://vapi.example/recordings/abc.mp3');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
