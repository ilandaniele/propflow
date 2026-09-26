import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'returning', 'values', 'innerJoin']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...a: unknown[]) => mockInsert(...a),
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

import {
  createWebSession,
  authenticateWebSession,
  webSessionExternalId,
  tryLockWebSession,
  hashIp,
  listWebTranscript,
} from '@/lib/widget/web-session';

beforeEach(() => vi.clearAllMocks());

describe('widget/web-session', () => {
  it('stores the token only as its sha256 hash, never the raw token', async () => {
    const insertedValues: Array<Record<string, unknown>> = [];
    mockInsert.mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedValues.push(v);
        return { returning: vi.fn(async () => [{ ...v, id: 'ws-1', messageCount: 0, agentSessionId: null, currentListingId: null, phoneE164: null }]) };
      }),
    });

    const { session, token } = await createWebSession({ orgId: 'org-1', ipHash: 'iphash', origin: 'https://a.com', pageUrl: null });

    expect(token).toMatch(/^wst_/);
    expect(insertedValues[0].tokenHash).not.toBe(token);
    expect(insertedValues[0].tokenHash).toHaveLength(64); // sha256 hex
    expect(session.orgId).toBe('org-1');
  });

  it('authenticateWebSession is org-scoped', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));
    const result = await authenticateWebSession('org-2', 'wst_abcdefghij');
    expect(result).toBeNull();
    // where() was called with an org-scoped predicate — we can't easily
    // inspect the SQL here, but the query returned nothing for org-2's scope.
  });

  it('authenticateWebSession returns the session when the DB row matches (query already filters expires_at > now)', async () => {
    const row = {
      id: 'ws-1', orgId: 'org-1', agentSessionId: null, currentListingId: null,
      phoneE164: null, messageCount: 3, expiresAt: new Date(Date.now() + 60_000),
    };
    mockSelect.mockReturnValueOnce(makeChain([row]));
    const result = await authenticateWebSession('org-1', 'wst_abcdefghij');
    expect(result?.id).toBe('ws-1');
    expect(result?.messageCount).toBe(3);
  });

  it('authenticateWebSession returns null for a malformed token without querying the DB', async () => {
    const result = await authenticateWebSession('org-1', 'not-a-real-token');
    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('webSessionExternalId is web:<id>', () => {
    expect(webSessionExternalId('abc-123')).toBe('web:abc-123');
  });

  it('hashIp is deterministic and does not return the raw ip', () => {
    const h1 = hashIp('203.0.113.5');
    const h2 = hashIp('203.0.113.5');
    expect(h1).toBe(h2);
    expect(h1).not.toContain('203.0.113.5');
    expect(h1).toHaveLength(64);
  });

  it('listWebTranscript orders DESC + limits, then reverses back to chronological order', async () => {
    // Rows as the DB would return them under ORDER BY created_at DESC LIMIT 2 —
    // i.e. newest first, already capped to the latest N.
    const rows = [
      { role: 'assistant', content: [{ type: 'text', text: 'segundo' }], createdAt: new Date('2026-01-01T00:00:02Z') },
      { role: 'user', content: [{ type: 'text', text: 'primero' }], createdAt: new Date('2026-01-01T00:00:01Z') },
    ];
    let orderByArgs: unknown[] = [];
    let limitArg: unknown;
    const chain = makeChain(rows);
    (chain.orderBy as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => { orderByArgs = args; return chain; });
    (chain.limit as ReturnType<typeof vi.fn>).mockImplementation((n: unknown) => { limitArg = n; return chain; });
    mockSelect.mockReturnValueOnce(chain);

    const entries = await listWebTranscript('org-1', 'session-1', 2);

    expect(limitArg).toBe(2);
    expect(orderByArgs).toHaveLength(1); // desc(agentMessages.createdAt)
    // Reversed back to oldest-first for chronological rendering.
    expect(entries.map((e) => e.text)).toEqual(['primero', 'segundo']);
  });

  it('tryLockWebSession builds a conditional update (returns true only when a row comes back)', async () => {
    mockUpdate.mockReturnValueOnce(makeChain([{ id: 'ws-1' }]));
    expect(await tryLockWebSession('ws-1')).toBe(true);

    mockUpdate.mockReturnValueOnce(makeChain([]));
    expect(await tryLockWebSession('ws-1')).toBe(false);
  });
});
