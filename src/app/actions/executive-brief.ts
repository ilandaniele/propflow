'use server';

/**
 * src/app/actions/executive-brief.ts
 *
 * Server Actions for the Executive Brief page:
 *   runHiddenLeakDetector — calls detectHiddenLeaks() against the org's data
 *
 * Security:
 *   AC30: requireAdmin() + Zod schema + mutationRateLimit
 *   AC8:  orgId from requireAdmin() context — never from client params
 *
 * Migrated from Supabase to Drizzle (W6 — detectHiddenLeaks no longer needs a client).
 */

import { requireAdmin } from '@/lib/auth/guards';
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
    const findings = await detectHiddenLeaks(ctx.orgId);
    return ok(findings);
  } catch {
    return Errors.INTERNAL();
  }
}
