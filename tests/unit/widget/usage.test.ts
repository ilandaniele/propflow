import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'values', 'onConflictDoUpdate', 'returning']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const mockInsert = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...a: unknown[]) => mockInsert(...a),
  },
}));

import { incrementWebUsage } from '@/lib/widget/usage';

beforeEach(() => vi.clearAllMocks());

describe('widget/usage — incrementWebUsage', () => {
  it('is an atomic upsert: insert(...).onConflictDoUpdate(...).returning(...)', async () => {
    const chain = makeChain([{ sessions: 1, messages: 0 }]);
    mockInsert.mockReturnValue(chain);

    const result = await incrementWebUsage('org-1', 'sessions', 150);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ allowed: true, count: 1 });
  });

  it('allowed=false once the count exceeds the cap', async () => {
    mockInsert.mockReturnValue(makeChain([{ sessions: 0, messages: 301 }]));

    const result = await incrementWebUsage('org-1', 'messages', 300);

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(301);
  });

  it('allowed=true exactly at the cap', async () => {
    mockInsert.mockReturnValue(makeChain([{ sessions: 0, messages: 300 }]));

    const result = await incrementWebUsage('org-1', 'messages', 300);

    expect(result.allowed).toBe(true);
  });
});
