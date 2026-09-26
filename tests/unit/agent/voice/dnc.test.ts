import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chain that's both fluent (.from().where()...) and awaitable at any point —
// awaiting it (with or without a trailing .limit()) resolves to `rows`.
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'orderBy', 'values', 'onConflictDoNothing']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const eqSpy = vi.fn();
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => {
      eqSpy(...args);
      return actual.eq(...args);
    },
  };
});

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

import { voiceDoNotCall } from '@/lib/db/schema';
import { isOnDoNotCallList, addDoNotCall, removeDoNotCall } from '@/lib/agent/voice/dnc';

beforeEach(() => vi.clearAllMocks());

describe('agent/voice/dnc — phone normalization (item 3)', () => {
  it('isOnDoNotCallList normalizes a phone missing the leading + before comparing', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));

    await isOnDoNotCallList('org-1', '51987654321');

    const phoneCall = eqSpy.mock.calls.find((c) => c[0] === voiceDoNotCall.phoneE164);
    expect(phoneCall?.[1]).toBe('+51987654321');
  });

  it('addDoNotCall normalizes the stored phoneE164', async () => {
    const values = vi.fn(() => makeChain([]));
    mockInsert.mockReturnValueOnce({ values });

    await addDoNotCall({ orgId: 'org-1', phoneE164: '51987654321', source: 'staff' });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ phoneE164: '+51987654321' }));
  });

  it('removeDoNotCall normalizes the phone for both the lookup and the delete', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ source: 'staff' }]));
    mockDelete.mockReturnValueOnce(makeChain([]));

    const result = await removeDoNotCall('org-1', '51987654321');

    expect(result).toBe('removed');
    const phoneCalls = eqSpy.mock.calls.filter((c) => c[0] === voiceDoNotCall.phoneE164);
    expect(phoneCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of phoneCalls) expect(c[1]).toBe('+51987654321');
  });

  it('removeDoNotCall still normalizes an already-well-formed E.164 phone (no-op)', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));

    const result = await removeDoNotCall('org-1', '+51987654321');

    expect(result).toBe('not_found');
    const phoneCall = eqSpy.mock.calls.find((c) => c[0] === voiceDoNotCall.phoneE164);
    expect(phoneCall?.[1]).toBe('+51987654321');
  });
});
