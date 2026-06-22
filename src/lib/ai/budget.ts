/**
 * src/lib/ai/budget.ts
 *
 * Per-org daily AI token budget enforcement.
 *
 * Spec: $5/org/day ceiling. At claude-3-haiku pricing (~$0.00010/1k input tokens,
 * ~$0.00050/1k output tokens) the conservative equivalent is 50 000 tokens/day.
 * We track combined input+output tokens.
 *
 * AC30 (LLM10): checkAndIncrementBudget() is called in every AI route BEFORE
 * the Anthropic API call. Returns false if the org is over the daily limit.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { aiTokenBudget } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '@/lib/log';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Daily token budget per org (conservative; see module doc). */
export const DAILY_TOKEN_BUDGET = 50_000;

/** USD cost ceiling per org per day. */
export const DAILY_COST_CEILING_USD = 5.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetCheckResult {
  /** true = under budget, allowed to proceed; false = budget exceeded, refuse. */
  allowed: boolean;
  /** Tokens used today BEFORE this request (0 if first of the day). */
  tokensUsedToday: number;
  /** Remaining tokens for the day BEFORE incrementing. */
  tokensRemaining: number;
}

// ---------------------------------------------------------------------------
// checkAndIncrementBudget
// ---------------------------------------------------------------------------

/**
 * Check whether the org has remaining budget for `tokensRequested` tokens.
 * If allowed, increment the counter atomically (upsert on today's date).
 *
 * @param orgId          — The organization UUID.
 * @param tokensRequested — Estimated tokens for this request (input + output).
 * @returns BudgetCheckResult
 */
export async function checkAndIncrementBudget(
  orgId: string,
  tokensRequested: number,
): Promise<BudgetCheckResult> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch today's row (if any)
  let existing: { id: string; tokensUsed: number } | undefined;
  try {
    const rows = await db
      .select({ id: aiTokenBudget.id, tokensUsed: aiTokenBudget.tokensUsed })
      .from(aiTokenBudget)
      .where(and(eq(aiTokenBudget.orgId, orgId), eq(aiTokenBudget.day, today)))
      .limit(1);
    existing = rows[0];
  } catch (err) {
    log.error('[ai/budget] fetch error', { error: (err as Error).message, orgId });
    return { allowed: false, tokensUsedToday: DAILY_TOKEN_BUDGET, tokensRemaining: 0 };
  }

  const tokensUsedToday = existing?.tokensUsed ?? 0;
  const tokensRemaining = Math.max(0, DAILY_TOKEN_BUDGET - tokensUsedToday);

  if (tokensUsedToday + tokensRequested > DAILY_TOKEN_BUDGET) {
    log.warn('[ai/budget] daily budget exceeded', {
      orgId,
      tokensUsedToday,
      tokensRequested,
      limit: DAILY_TOKEN_BUDGET,
    });
    return { allowed: false, tokensUsedToday, tokensRemaining };
  }

  // Atomic upsert — increment the counter
  try {
    await db
      .insert(aiTokenBudget)
      .values({
        orgId,
        day: today,
        tokensUsed: tokensRequested,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aiTokenBudget.orgId, aiTokenBudget.day],
        set: {
          tokensUsed: tokensUsedToday + tokensRequested,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.error('[ai/budget] upsert error', { error: (err as Error).message, orgId });
    return { allowed: false, tokensUsedToday, tokensRemaining };
  }

  log.info('[ai/budget] tokens allocated', {
    orgId,
    tokensRequested,
    newTotal: tokensUsedToday + tokensRequested,
    limit: DAILY_TOKEN_BUDGET,
  });

  return { allowed: true, tokensUsedToday, tokensRemaining };
}

// ---------------------------------------------------------------------------
// recordActualUsage (called AFTER a successful Anthropic API response)
// ---------------------------------------------------------------------------

/**
 * Update the token counter with the actual usage reported by the API response.
 * Called after a successful Anthropic call to replace the estimate with truth.
 */
export async function recordActualUsage(
  orgId: string,
  actualTokens: number,
  estimatedTokens: number,
): Promise<void> {
  const delta = actualTokens - estimatedTokens;
  if (delta === 0) return;

  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ tokensUsed: aiTokenBudget.tokensUsed })
    .from(aiTokenBudget)
    .where(and(eq(aiTokenBudget.orgId, orgId), eq(aiTokenBudget.day, today)))
    .limit(1);

  if (!rows[0]) return; // row was removed or date rolled over

  const newTotal = Math.max(0, rows[0].tokensUsed + delta);

  await db
    .update(aiTokenBudget)
    .set({ tokensUsed: newTotal, updatedAt: new Date() })
    .where(and(eq(aiTokenBudget.orgId, orgId), eq(aiTokenBudget.day, today)));
}

// ---------------------------------------------------------------------------
// getBudgetStatus (read-only — used by UI tiles)
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  day: string;
  tokensUsed: number;
  tokensLimit: number;
  percentUsed: number;
  isExceeded: boolean;
}

/**
 * Return today's budget status for the given org (read-only).
 * Returns zeroed status if no row exists yet (first request of the day).
 */
export async function getBudgetStatus(orgId: string): Promise<BudgetStatus> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ tokensUsed: aiTokenBudget.tokensUsed })
    .from(aiTokenBudget)
    .where(and(eq(aiTokenBudget.orgId, orgId), eq(aiTokenBudget.day, today)))
    .limit(1);

  const tokensUsed = rows[0]?.tokensUsed ?? 0;
  const percentUsed =
    DAILY_TOKEN_BUDGET > 0
      ? Math.min(100, Math.round((tokensUsed / DAILY_TOKEN_BUDGET) * 100))
      : 0;

  return {
    day:         today,
    tokensUsed,
    tokensLimit: DAILY_TOKEN_BUDGET,
    percentUsed,
    isExceeded:  tokensUsed >= DAILY_TOKEN_BUDGET,
  };
}
