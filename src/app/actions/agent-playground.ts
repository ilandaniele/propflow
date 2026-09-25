'use server';

import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { aiChatRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { runAgentTurn } from '@/lib/agent/run-turn';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

const InputSchema = z.object({
  message: z.string().min(1).max(2000),
});

export interface PlaygroundTurnResult {
  replyText: string;
  handedOffToHuman: boolean;
}

/**
 * Runs one playground turn — always dryRun (mutating tools describe instead
 * of writing) and always on a per-admin scratch session, so testing the
 * agent never pollutes real leads or spends the org's real AI budget.
 */
export async function runPlaygroundTurn(
  _prev: ActionResult<PlaygroundTurnResult>,
  formData: FormData
): Promise<ActionResult<PlaygroundTurnResult>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = aiChatRateLimit(ctx.userId, ctx.orgId);
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = InputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const result = await runAgentTurn({
      orgId: ctx.orgId,
      channel: 'web',
      externalId: `playground:${ctx.userId}`,
      inboundText: parsed.data.message,
      dryRun: true,
    });

    return ok({ replyText: result.replyText, handedOffToHuman: result.handedOffToHuman });
  } catch (e) {
    log.error('[agent-playground] turn failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : 'unknown' });
    return Errors.INTERNAL();
  }
}
