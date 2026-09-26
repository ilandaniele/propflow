import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chain that's both fluent (.from().where()...) and awaitable at any point —
// awaiting it (with or without a trailing .returning()) resolves to `rows`.
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'returning', 'values']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

const eqSpy = vi.fn();
const lteSpy = vi.fn();
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => {
      eqSpy(...args);
      return actual.eq(...args);
    },
    lte: (...args: Parameters<typeof actual.lte>) => {
      lteSpy(...args);
      return actual.lte(...args);
    },
  };
});

import { agentWebHandoffCodes } from '@/lib/db/schema';
import {
  generateHandoffCode,
  extractHandoffCode,
  buildWhatsAppDeepLink,
  createHandoffCode,
  claimHandoffCode,
  MAX_CODES_PER_SESSION_PER_DAY,
} from '@/lib/widget/handoff-codes';

beforeEach(() => {
  vi.clearAllMocks();
  eqSpy.mockClear();
  lteSpy.mockClear();
});

describe('widget/handoff-codes — pure helpers', () => {
  it('generateHandoffCode never uses 0/O/1/I', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateHandoffCode();
      expect(code).toMatch(/^WEB-[A-HJ-NP-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('extractHandoffCode finds a valid code and uppercases a lowercase match', () => {
    expect(extractHandoffCode('Hola, confirmo mi visita. Código WEB-AB2K9M')).toBe('WEB-AB2K9M');
    expect(extractHandoffCode('code web-ab2k9m please')).toBe('WEB-AB2K9M');
  });

  it('Phase 8: generateHandoffCode/extractHandoffCode support the VOZ- prefix', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateHandoffCode('voice');
      expect(code).toMatch(/^VOZ-[A-HJ-NP-Z2-9]{6}$/);
    }
    expect(extractHandoffCode('Confirmo VOZ-AB2K9M')).toBe('VOZ-AB2K9M');
    expect(extractHandoffCode('confirmo voz-ab2k9m')).toBe('VOZ-AB2K9M');
  });

  it('extractHandoffCode ignores near-misses', () => {
    expect(extractHandoffCode('WEB-12')).toBeNull();
    expect(extractHandoffCode('referencia ABC123')).toBeNull();
    expect(extractHandoffCode(null)).toBeNull();
  });

  it('buildWhatsAppDeepLink encodes the text and strips non-digits from the phone', () => {
    const link = buildWhatsAppDeepLink('+51 987-654-321', 'Hola, confirmo mi visita. Código WEB-AB2K9M');
    expect(link).toBe(
      'https://wa.me/51987654321?text=' + encodeURIComponent('Hola, confirmo mi visita. Código WEB-AB2K9M'),
    );
  });
});

describe('widget/handoff-codes — createHandoffCode', () => {
  it('returns null once the session hits the daily cap', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ value: MAX_CODES_PER_SESSION_PER_DAY }]));

    const result = await createHandoffCode({
      orgId: 'org-1', webSessionId: 'ws-1', kind: 'continue', leadId: null,
    });

    expect(result).toBeNull();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('supersedes an earlier pending code of the same session+kind before inserting', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ value: 0 }]));

    const txUpdateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
    const insertedRow = {
      id: 'code-1', orgId: 'org-1', webSessionId: 'ws-1', code: 'WEB-AB2K9M', kind: 'continue',
      leadId: null, listingId: null, profileId: null, startsAt: null, visitMinutes: null,
      status: 'pending', expiresAt: new Date(),
    };
    const txInsert = vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [insertedRow]) })) }));
    mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ update: txUpdate, insert: txInsert }));

    const result = await createHandoffCode({ orgId: 'org-1', webSessionId: 'ws-1', kind: 'continue', leadId: null });

    expect(result?.status).toBe('pending');
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }));
  });

  it('item 11: the voice daily-cap check is scoped to this org (not just the phone)', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ value: 0 }]));
    const txUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));
    const txInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'code-v', orgId: 'org-1', webSessionId: null, code: 'VOZ-AB2K9M', kind: 'visit', leadId: null, listingId: null, profileId: null, startsAt: null, visitMinutes: null, status: 'pending', expiresAt: new Date(), source: 'voice', callId: 'call-1', targetPhone: '+51987654321' }]),
      })),
    }));
    mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn({ update: txUpdate, insert: txInsert }));

    await createHandoffCode({ orgId: 'org-1', kind: 'visit', leadId: null, source: 'voice', callId: 'call-1', targetPhone: '+51987654321' });

    const orgIdCalls = eqSpy.mock.calls.filter((c) => c[0] === agentWebHandoffCodes.orgId);
    expect(orgIdCalls.length).toBeGreaterThanOrEqual(1);
    expect(orgIdCalls.every((c) => c[1] === 'org-1')).toBe(true);
  });

  it('item 11: the voice supersede condition is scoped to this org', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ value: 0 }]));
    const txUpdateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
    const txInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'code-v2', orgId: 'org-1', webSessionId: null, code: 'VOZ-ZZ9988', kind: 'visit', leadId: null, listingId: null, profileId: null, startsAt: null, visitMinutes: null, status: 'pending', expiresAt: new Date(), source: 'voice', callId: 'call-1', targetPhone: '+51987654321' }]),
      })),
    }));
    mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn({ update: txUpdate, insert: txInsert }));

    await createHandoffCode({ orgId: 'org-1', kind: 'visit', leadId: null, source: 'voice', callId: 'call-1', targetPhone: '+51987654321' });

    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }));
    const orgIdCalls = eqSpy.mock.calls.filter((c) => c[0] === agentWebHandoffCodes.orgId);
    // At least two eq(orgId, ...) checks: the daily-cap read + the supersede update.
    expect(orgIdCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('retries with a fresh code on a unique-constraint collision', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ value: 0 }]));

    const insertedRow = {
      id: 'code-2', orgId: 'org-1', webSessionId: 'ws-1', code: 'WEB-ZZ9988', kind: 'continue',
      leadId: null, listingId: null, profileId: null, startsAt: null, visitMinutes: null,
      status: 'pending', expiresAt: new Date(),
    };
    const collision = Object.assign(new Error('duplicate key value violates unique constraint "uq_web_handoff_code"'), { code: '23505' });

    let call = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      call++;
      const txUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));
      const txInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (call === 1) throw collision;
            return [insertedRow];
          }),
        })),
      }));
      return fn({ update: txUpdate, insert: txInsert });
    });

    const result = await createHandoffCode({ orgId: 'org-1', webSessionId: 'ws-1', kind: 'continue', leadId: null });

    expect(call).toBe(2);
    expect(result?.code).toBe('WEB-ZZ9988');
  });
});

describe('widget/handoff-codes — claimHandoffCode', () => {
  it('returns the redeemed row when the code is pending and unexpired', async () => {
    const row = {
      id: 'code-3', orgId: 'org-1', webSessionId: 'ws-1', code: 'WEB-AB2K9M', kind: 'visit',
      leadId: 'lead-1', listingId: null, profileId: 'profile-1', startsAt: new Date(), visitMinutes: 45,
      status: 'redeemed', expiresAt: new Date(),
    };
    mockUpdate.mockReturnValueOnce(makeChain([row]));

    const result = await claimHandoffCode('org-1', 'WEB-AB2K9M', '+51987654321', 'wa-session-1');
    expect(result).not.toBe('expired');
    expect(result).not.toBeNull();
    expect((result as typeof row).status).toBe('redeemed');
  });

  it("marks an expired pending code 'expired' and returns 'expired' instead of null", async () => {
    mockUpdate.mockReturnValueOnce(makeChain([])); // redeem attempt: no match (expired)
    mockUpdate.mockReturnValueOnce(makeChain([{ id: 'code-4' }])); // mark-expired: matched

    const result = await claimHandoffCode('org-1', 'WEB-AB2K9M', '+51987654321', 'wa-session-1');
    expect(result).toBe('expired');
  });

  it('returns null for an unknown code (including one from another org)', async () => {
    mockUpdate.mockReturnValueOnce(makeChain([]));
    mockUpdate.mockReturnValueOnce(makeChain([]));

    const result = await claimHandoffCode('org-1', 'WEB-NOPE99', '+51987654321', 'wa-session-1');
    expect(result).toBeNull();
  });

  it('item 12: the fallback "mark expired" update only matches codes whose expiresAt has actually passed', async () => {
    mockUpdate.mockReturnValueOnce(makeChain([])); // redeem attempt: no match
    mockUpdate.mockReturnValueOnce(makeChain([])); // mark-expired attempt: no match either (not actually expired)

    const result = await claimHandoffCode('org-1', 'WEB-NOPE99', '+51987654321', 'wa-session-1');

    expect(result).toBeNull();
    const expiresAtLteCalls = lteSpy.mock.calls.filter((c) => c[0] === agentWebHandoffCodes.expiresAt);
    expect(expiresAtLteCalls.length).toBe(1);
  });

  it('Phase 8: a voice code redeemed from another phone fails the claim (falls through to the not-found/expired path)', async () => {
    // The WHERE clause's `or(source='web', target_phone=$phone)` excludes this
    // row at the DB level — the mock simulates that by returning no rows for
    // both the redeem and the mark-expired attempts (the row IS pending and
    // unexpired, but for a different target_phone, so a real DB wouldn't match either).
    mockUpdate.mockReturnValueOnce(makeChain([]));
    mockUpdate.mockReturnValueOnce(makeChain([]));

    const result = await claimHandoffCode('org-1', 'VOZ-AB2K9M', '+51999999999', 'wa-session-1');
    expect(result).toBeNull();
  });
});
