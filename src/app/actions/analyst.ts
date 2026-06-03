'use server';

/**
 * src/app/actions/analyst.ts
 *
 * Server Actions for the AI Analyst page — AC15.
 *
 * runDeterministicAnalysis: dispatches to a deterministic TypeScript function
 * and returns a structured result. NO LLM call is made.
 *
 * Security: requireAdmin + mutationRateLimit + Zod validation.
 */

import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { z } from 'zod';
import {
  analyzePortfolio,
  ANALYST_PROMPT_SLUGS,
  type AnalystResult,
} from '@/lib/analyst/index';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RunAnalysisSchema = z.object({
  slug: z.enum(ANALYST_PROMPT_SLUGS),
});

// ---------------------------------------------------------------------------
// runDeterministicAnalysis
// ---------------------------------------------------------------------------

export async function runDeterministicAnalysis(
  rawSlug: string,
): Promise<{ data?: AnalystResult; error?: { code: string; message: string; details?: unknown } }> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit (read-heavy but dispatched via server action)
  const rl = mutationRateLimit(ctx.userId, 'analyst:run');
  if (!rl.success) {
    return Errors.RATE_LIMITED();
  }

  // 3. Validate input
  const parsed = RunAnalysisSchema.safeParse({ slug: rawSlug });
  if (!parsed.success) {
    return Errors.VALIDATION_ERROR(parsed.error.flatten());
  }

  // 4. Execute deterministic function — NO LLM call
  const supabase = await createClient();
  try {
    const result = await analyzePortfolio(supabase, ctx.orgId, parsed.data.slug);
    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    // Log code only — never log PII or stack trace in production
    console.error('[analyst] dispatch error', { slug: parsed.data.slug, error: msg });
    return Errors.INTERNAL();
  }
}
