'use server';

/**
 * src/app/actions/executive-brief.ts
 *
 * Server Actions for the Executive Brief page:
 *   runHiddenLeakDetector — calls detectHiddenLeaks() against the org's data
 *
 * Security:
 *   AC30: requireAdmin() + Zod schema + mutationRateLimit
 *   RLS:  uses createClient() (anon key, RLS active) — no service role
 */

import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { detectHiddenLeaks } from '@/lib/finance/leak-detector';
import type { ActionResult } from '@/lib/errors';
import type { LeakFinding } from '@/lib/finance/leak-detector';

/**
 * Run the Hidden Leak Detector for the admin's org.
 * Returns an array of LeakFinding where billed - collected > 15%.
 */
export async function runHiddenLeakDetector(): Promise<ActionResult<LeakFinding[]>> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // AC30: rate limit — 10 detections per minute per admin user
  const rl = mutationRateLimit(ctx.userId, 'leak-detector');
  if (!rl.success) {
    return Errors.RATE_LIMITED();
  }

  try {
    const supabase = await createClient();
    const findings = await detectHiddenLeaks(supabase);
    return ok(findings);
  } catch {
    return Errors.INTERNAL();
  }
}
