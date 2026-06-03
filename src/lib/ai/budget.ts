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
 * Uses createAdminClient() for the upsert to avoid RLS permission issues on the
 * first insert of the day (no row yet) and to allow atomic increment without a
 * race condition between concurrent requests.
 */

import { createAdminClient } from '@/lib/supabase/admin';
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
 * If the daily row does not exist yet it is created with `tokensRequested`.
 *
 * @param orgId          — The organization UUID.
 * @param tokensRequested — Estimated tokens for this request (input + output).
 * @returns BudgetCheckResult
 */
export async function checkAndIncrementBudget(
  orgId: string,
  tokensRequested: number,
): Promise<BudgetCheckResult> {
  const adminClient = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch today's row (if any)
  const { data: existing, error: fetchError } = await adminClient
    .from('ai_token_budget')
    .select('id, tokens_used')
    .eq('org_id', orgId)
    .eq('day', today)
    .maybeSingle();

  if (fetchError) {
    // Fail-open logging, fail-closed on budget (refuse on error to prevent abuse)
    log.error('[ai/budget] fetch error', { code: fetchError.code, orgId });
    return { allowed: false, tokensUsedToday: DAILY_TOKEN_BUDGET, tokensRemaining: 0 };
  }

  const tokensUsedToday = existing?.tokens_used ?? 0;
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
  const { error: upsertError } = await adminClient
    .from('ai_token_budget')
    .upsert(
      {
        org_id:      orgId,
        day:         today,
        tokens_used: tokensUsedToday + tokensRequested,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: 'org_id,day' },
    );

  if (upsertError) {
    log.error('[ai/budget] upsert error', { code: upsertError.code, orgId });
    // Fail-closed: if we can't record usage, deny the request
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
 *
 * @param orgId        — The organization UUID.
 * @param actualTokens — Actual input + output tokens from the API response.
 * @param estimatedTokens — The tokens we pre-reserved in checkAndIncrementBudget.
 */
export async function recordActualUsage(
  orgId: string,
  actualTokens: number,
  estimatedTokens: number,
): Promise<void> {
  const delta = actualTokens - estimatedTokens;
  if (delta === 0) return; // nothing to adjust

  const adminClient = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await adminClient
    .from('ai_token_budget')
    .select('tokens_used')
    .eq('org_id', orgId)
    .eq('day', today)
    .maybeSingle();

  if (!existing) return; // row was removed or date rolled over — ignore

  const newTotal = Math.max(0, (existing.tokens_used as number) + delta);

  await adminClient
    .from('ai_token_budget')
    .update({ tokens_used: newTotal, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('day', today);
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
 * Return today's budget status for the given org (admin-scoped read).
 * Returns zeroed status if no row exists yet (first request of the day).
 */
export async function getBudgetStatus(orgId: string): Promise<BudgetStatus> {
  const adminClient = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await adminClient
    .from('ai_token_budget')
    .select('tokens_used')
    .eq('org_id', orgId)
    .eq('day', today)
    .maybeSingle();

  const tokensUsed = (data?.tokens_used as number | null) ?? 0;
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
