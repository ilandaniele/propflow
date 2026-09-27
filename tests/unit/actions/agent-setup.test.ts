/**
 * Unit tests for saveWhatsAppChannel (src/app/actions/agent-setup.ts).
 *
 * Covers:
 * 1. Auth: non-admin -> UNAUTHORIZED; rate-limited -> RATE_LIMITED.
 * 2. Validation: bad phoneNumberId / bad E.164 display phone -> VALIDATION_ERROR.
 * 3. Cross-org: a phoneNumberId already bound to ANOTHER org -> CONFLICT, no write.
 * 4. orgId is taken from the session only (IDOR) — never trusts caller input.
 * 5. Upsert: inserts when no row exists, updates when one does (inside a transaction).
 * 6. WHATSAPP_PHONE_NUMBER_ID env: mismatch -> VALIDATION_ERROR; unset -> allowed + warning.
 * 7. WHATSAPP_ACCESS_TOKEN env: Graph ownership check — mismatch/failure -> VALIDATION_ERROR,
 *    never leaks the token; unset -> check skipped.
 * 8. A 23505 raised inside the transaction (race with another request) -> CONFLICT.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';
const OTHER_ORG_UUID = '550e8400-e29b-41d4-a716-446655440099';

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/widget/channel', () => ({
  E164_RE: /^\+[1-9]\d{6,14}$/,
}));

const insertValues = vi.fn(async () => undefined);
const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));

// select() is called twice per transaction, strictly in sequence: (1) the
// cross-org conflict check, (2) the existing-row lookup for this org — a
// plain queue keyed on call order is enough (no concurrency here).
const selectQueue: Array<unknown[]> = [];
let transactionError: unknown = null;

function makeTxHandle() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectQueue.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };
}

vi.mock('@/lib/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (transactionError) {
        const err = transactionError;
        transactionError = null;
        throw err;
      }
      return fn(makeTxHandle());
    }),
  },
}));

import { saveWhatsAppChannel } from '@/app/actions/agent-setup';

const ENV_KEYS = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  selectQueue.length = 0;
  transactionError = null;
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

const VALID_INPUT = { phoneNumberId: '123456789012345', displayPhoneE164: '+51987654321' };

/** Queues the two sequential select() results: the cross-org conflict check, then the existing-row lookup. */
function queueSelects(conflictRows: Array<{ orgId: string }>, existingRows: Array<{ id: string; config: Record<string, unknown> }>) {
  selectQueue.push(conflictRows, existingRows);
}

describe('saveWhatsAppChannel — auth', () => {
  it('rejects a non-admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rate-limits', async () => {
    mockState.rateLimitSuccess = false;
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('RATE_LIMITED');
  });
});

describe('saveWhatsAppChannel — validation', () => {
  it('rejects a malformed phoneNumberId', async () => {
    const result = await saveWhatsAppChannel({ ...VALID_INPUT, phoneNumberId: 'abc' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-E.164 display phone', async () => {
    const result = await saveWhatsAppChannel({ ...VALID_INPUT, displayPhoneE164: '987654321' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('saveWhatsAppChannel — cross-org conflict', () => {
  it('rejects a phoneNumberId already bound to another org, without writing', async () => {
    queueSelects([{ orgId: OTHER_ORG_UUID }], []);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('CONFLICT');
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe('saveWhatsAppChannel — upsert', () => {
  it("inserts a new row scoped to the caller's own org when none exists (IDOR)", async () => {
    queueSelects([], []);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error).toBeUndefined();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_UUID,
      channel: 'whatsapp',
      externalId: VALID_INPUT.phoneNumberId,
    }));
  });

  it('updates the existing row instead of inserting a duplicate', async () => {
    queueSelects([], [{ id: 'chan-1', config: { displayPhoneE164: '+51900000000' } }]);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error).toBeUndefined();
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      externalId: VALID_INPUT.phoneNumberId,
      config: expect.objectContaining({ displayPhoneE164: VALID_INPUT.displayPhoneE164 }),
    }));
  });

  it('maps a 23505 raised inside the transaction (race) to CONFLICT', async () => {
    transactionError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('CONFLICT');
  });
});

describe('saveWhatsAppChannel — WHATSAPP_PHONE_NUMBER_ID env match', () => {
  it('rejects a phoneNumberId that does not match the configured env var', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999999999999999';
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(result.error?.details)).toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('accepts a phoneNumberId matching the configured env var, no warning', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = VALID_INPUT.phoneNumberId;
    queueSelects([], []);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error).toBeUndefined();
    expect(result.data?.warning).toBeUndefined();
  });

  it('allows saving with a warning when the env var is not configured yet', async () => {
    queueSelects([], []);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error).toBeUndefined();
    expect(result.data?.warning).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
  });
});

describe('saveWhatsAppChannel — Graph ownership check (WHATSAPP_ACCESS_TOKEN set)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-token-xxx';
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('accepts when Meta reports a matching display_phone_number', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ display_phone_number: '+51 987 654 321' }), { status: 200 }));
    queueSelects([], []);
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error).toBeUndefined();
  });

  it('rejects when the digits do not match, without leaking the token', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ display_phone_number: '+51 900 000 000' }), { status: 200 }));
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(result)).not.toContain('secret-token-xxx');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('rejects with a generic message (never the token) when the Graph call fails', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), { status: 401 }));
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(result)).not.toContain('secret-token-xxx');
  });

  it('rejects with a generic message when the Graph call throws (network/timeout)', async () => {
    fetchSpy.mockRejectedValue(new Error('timeout'));
    const result = await saveWhatsAppChannel(VALID_INPUT);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(result)).not.toContain('secret-token-xxx');
  });
});
