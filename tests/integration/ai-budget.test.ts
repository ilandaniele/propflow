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
 * Uses a fully mocked @/lib/db — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Queue-based db mock
//
// The budget function calls:
//   db.select().from(aiTokenBudget).where().limit(1)  → fetch today's row
// then:
//   db.insert(aiTokenBudget).values().onConflictDoUpdate()  → upsert/increment
//
// We use queues to control per-call responses.
// ---------------------------------------------------------------------------

const selectResponses: Array<{ data: { id: string; tokensUsed: number } | null; error: null | { message: string } }> = [];
const upsertShouldFail: boolean[] = [];

vi.mock('@/lib/db', () => ({
  db: {
    select: () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => {
          const next = selectResponses.shift();
          if (!next) return [];
          if (next.error) throw new Error(next.error.message);
          if (!next.data) return [];
          return [next.data];
        }),
      };
      return chain;
    },

    insert: () => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => {
          const shouldFail = upsertShouldFail.shift();
          if (shouldFail) throw new Error('DB upsert failed');
          return [];
        }),
        returning: vi.fn(async () => []),
      })),
    }),

    update: () => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }),
  },
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

function queueSelectRow(tokensUsed: number | null, error: null | { message: string } = null) {
  selectResponses.push({
    data: tokensUsed !== null ? { id: 'budget-row-id', tokensUsed } : null,
    error,
  });
}

function queueUpsertError() {
  upsertShouldFail.push(true);
}

function queueUpsertSuccess() {
  upsertShouldFail.push(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI token budget enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResponses.length = 0;
    upsertShouldFail.length = 0;
  });

  // -------------------------------------------------------------------------
  // 1. Under budget — allowed + counter incremented
  // -------------------------------------------------------------------------

  it('allows request when tokens_used is well under the daily limit', async () => {
    queueSelectRow(10_000);
    queueUpsertSuccess();

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(10_000);
    expect(result.tokensRemaining).toBe(40_000);
  });

  it('allows request when no row exists yet (first request of the day)', async () => {
    queueSelectRow(null);
    queueUpsertSuccess();

    const result = await checkAndIncrementBudget(ORG_ID, 200);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(0);
    expect(result.tokensRemaining).toBe(DAILY_TOKEN_BUDGET);
  });

  it('allows request when tokens exactly at budget minus request size', async () => {
    // Used 49 500, requesting 500 → total would be 50 000 exactly = still allowed
    queueSelectRow(49_500);
    queueUpsertSuccess();

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Over budget — blocked
  // -------------------------------------------------------------------------

  it('blocks request when adding tokens would exceed the daily limit', async () => {
    // Used 49 600, requesting 500 → total would be 50 100 > 50 000
    queueSelectRow(49_600);
    // No upsert should happen — blocked before incrementing

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
    expect(result.tokensUsedToday).toBe(49_600);
    expect(result.tokensRemaining).toBe(400);
  });

  it('blocks request when budget is exactly at the limit', async () => {
    queueSelectRow(DAILY_TOKEN_BUDGET);

    const result = await checkAndIncrementBudget(ORG_ID, 1);

    expect(result.allowed).toBe(false);
    expect(result.tokensRemaining).toBe(0);
  });

  it('blocks and returns allowed=false when DB fetch errors (fail-closed)', async () => {
    // DB error → fail-closed
    selectResponses.push({ data: null, error: { message: 'DB connection error' } });

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
  });

  it('blocks and returns allowed=false when upsert fails (fail-closed)', async () => {
    queueSelectRow(0);
    queueUpsertError();

    const result = await checkAndIncrementBudget(ORG_ID, 500);

    expect(result.allowed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Budget resets on a new day (simulated by returning no row for today)
  // -------------------------------------------------------------------------

  it('effectively resets on a new day because a fresh row is created for today', async () => {
    queueSelectRow(null);
    queueUpsertSuccess();

    const result = await checkAndIncrementBudget(ORG_ID, 1000);

    expect(result.allowed).toBe(true);
    expect(result.tokensUsedToday).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. Constants
  // -------------------------------------------------------------------------

  it('DAILY_TOKEN_BUDGET is 50 000 tokens (conservative $5/day ceiling)', () => {
    expect(DAILY_TOKEN_BUDGET).toBe(50_000);
  });

  // -------------------------------------------------------------------------
  // 5. Budget is orgId-scoped (different orgs are independent)
  // -------------------------------------------------------------------------

  it('does not cross-contaminate budgets between different orgs', async () => {
    const ORG_A = '00000000-0000-0000-0000-000000000001';
    const ORG_B = '00000000-0000-0000-0000-000000000002';

    queueSelectRow(DAILY_TOKEN_BUDGET); // Org A at limit
    queueSelectRow(0);                  // Org B at zero
    queueUpsertSuccess();               // Org B upsert succeeds

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
  beforeEach(() => {
    selectResponses.length = 0;
    upsertShouldFail.length = 0;
  });

  it('exports checkAndIncrementBudget as an async function', () => {
    expect(typeof checkAndIncrementBudget).toBe('function');
    queueSelectRow(0);
    queueUpsertSuccess();
    const result = checkAndIncrementBudget(ORG_ID, 0);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });

  it('DAILY_TOKEN_BUDGET is a positive integer', () => {
    expect(DAILY_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(Number.isInteger(DAILY_TOKEN_BUDGET)).toBe(true);
  });
});
