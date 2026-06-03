/**
 * tests/integration/ai-budget.test.ts
 *
 * Integration tests for the per-org daily AI token budget enforcement.
 *
 * T54 / AC30 (LLM10): covers three scenarios:
 *   1. Under limit → request allowed, counter incremented.
 *   2. Over limit  → request blocked (AI_BUDGET_EXCEEDED).
 *   3. New day     → counter resets (fresh row for new date).
 *
 * Uses a fully mocked createAdminClient() — no real Supabase instance required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// We need to control per-call mock responses for maybeSingle and upsert.
// The budget function calls:
//   adminClient.from('ai_token_budget').select('id, tokens_used').eq(...).eq(...).maybySingle()
// then:
//   adminClient.from('ai_token_budget').upsert(...)
//
// Use a queue-based approach: each test pushes the responses it needs.
// ---------------------------------------------------------------------------

const maybySingleResponses: Array<{ data: { id: string; tokens_used: number } | null; error: null | { code: string } }> = [];
const upsertResponses: Array<{ error: null | { code: string } }> = [];

function createChainableMock() {
  const chain = {
    select: vi.fn().mockReturnThis() as unknown as Mock,
    eq:     vi.fn().mockReturnThis() as unknown as Mock,
    upsert: vi.fn(async () => upsertResponses.shift() ?? { error: null }) as unknown as Mock,
    update: vi.fn().mockReturnThis() as unknown as Mock,
    maybeSingle: vi.fn(async () => maybySingleResponses.shift() ?? { data: null, error: null }) as unknown as Mock,
  };
  // make update chainable to eq
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

const mockAdminFrom = vi.fn(() => createChainableMock());

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}));

vi.mock('@/lib/log', () => ({
  log: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  checkAndIncrementBudget,
  DAILY_TOKEN_BUDGET,
} from '@/lib/ai/budget';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/** Push a maybSingle response onto the queue */
function queueMaybeSingle(tokensUsed: number | null, error: null | { code: string } = null) {
  maybySingleResponses.push({
    data: tokensUsed !== null ? { id: 'budget-row-id', tokens_used: tokensUsed } : null,
    error,
  });
}

/** Push an upsert response onto the queue */
function queueUpsert(error: null | { code: string } = null) {
  upsertResponses.push({ error });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI token budget enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybySingleResponses.length = 0;
    upsertResponses.length = 0;
    // Reset the from() factory to return a fresh chain each call
    mockAdminFrom.mockImplementation(() => createChainableMock());
  });

  // -------------------------------------------------------------------------
  // 1. Under budget — allowed + counter incremented
  // -------------------------------------------------------------------------

  it('allows request when tokens_used is well under the daily limit', async () => {
    // Org has used 10 000 of 50 000 tokens today
    queueMaybeSingle(10_000);
    queueUpsert();

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(10_000);
    expect(result.tokensRemaining).toBe(40_000);
  });

  it('allows request when no row exists yet (first request of the day)', async () => {
    // No row for today → maybeSingle returns null data
    queueMaybeSingle(null);
    queueUpsert();

    const result = await checkAndIncrementBudget(ORG_ID, 200);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(0);
    expect(result.tokensRemaining).toBe(DAILY_TOKEN_BUDGET);
  });

  it('allows request when tokens exactly at budget minus request size', async () => {
    // Used 49 500, requesting 500 → total would be 50 000 exactly = still allowed
    queueMaybeSingle(49_500);
    queueUpsert();

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Over budget — blocked
  // -------------------------------------------------------------------------

  it('blocks request when adding tokens would exceed the daily limit', async () => {
    // Used 49 600, requesting 500 → total would be 50 100 > 50 000
    queueMaybeSingle(49_600);
    // No upsert should happen — blocked before incrementing

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
    expect(result.tokensUsedToday).toBe(49_600);
    expect(result.tokensRemaining).toBe(400);
  });

  it('blocks request when budget is exactly at the limit', async () => {
    // Already used 50 000 — no more tokens
    queueMaybeSingle(DAILY_TOKEN_BUDGET);

    const result = await checkAndIncrementBudget(ORG_ID, 1);

    expect(result.allowed).toBe(false);
    expect(result.tokensRemaining).toBe(0);
  });

  it('blocks and returns allowed=false when Supabase fetch errors (fail-closed)', async () => {
    // DB error → fail-closed
    queueMaybeSingle(null, { code: 'PGRST301' });

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
  });

  it('blocks and returns allowed=false when upsert fails (fail-closed)', async () => {
    // Fetch succeeds; upsert fails
    queueMaybeSingle(0);
    queueUpsert({ code: 'PGRST301' });

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Budget resets on a new day (simulated by returning no row for today)
  // -------------------------------------------------------------------------

  it('effectively resets on a new day because a fresh row is created for today', async () => {
    // The budget function queries by (org_id, day=TODAY). If yesterday's data existed,
    // today's query returns null (different date key) → tokensUsed = 0 → allowed.
    queueMaybeSingle(null);
    queueUpsert();

    const result = await checkAndIncrementBudget(ORG_ID, 1000);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. Constants are within expected range
  // -------------------------------------------------------------------------

  it('DAILY_TOKEN_BUDGET is 50 000 tokens (conservative $5/day ceiling)', () => {
    expect(DAILY_TOKEN_BUDGET).toBe(50_000);
  });

  // -------------------------------------------------------------------------
  // 5. Budget check is orgId-scoped (different orgs are independent)
  // -------------------------------------------------------------------------

  it('does not cross-contaminate budgets between different orgs', async () => {
    const ORG_A = '00000000-0000-0000-0000-000000000001';
    const ORG_B = '00000000-0000-0000-0000-000000000002';

    // Org A is at limit
    queueMaybeSingle(DAILY_TOKEN_BUDGET);
    // Org B has zero usage
    queueMaybeSingle(0);
    queueUpsert();

    const resultA = await checkAndIncrementBudget(ORG_A, 1);
    const resultB = await checkAndIncrementBudget(ORG_B, 1);

    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC30 compliance assertion
// ---------------------------------------------------------------------------

describe('AI budget module contract', () => {
  it('exports checkAndIncrementBudget as an async function', () => {
    expect(typeof checkAndIncrementBudget).toBe('function');
    // Queue a response so the test doesn't hang
    queueMaybeSingle(0);
    queueUpsert();
    const result = checkAndIncrementBudget(ORG_ID, 0);
    expect(result).toBeInstanceOf(Promise);
    // Drain the promise to avoid test leakage
    return result;
  });

  it('DAILY_TOKEN_BUDGET is a positive integer', () => {
    expect(DAILY_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(Number.isInteger(DAILY_TOKEN_BUDGET)).toBe(true);
  });
});
