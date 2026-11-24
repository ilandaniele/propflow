'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { GenerateStatementsSchema } from '@/lib/schemas/statement';
import { generateStatements } from '@/lib/finance/generate-statements';

export type GenerateStatementsResult = ActionResult<{ created: number; skipped: number }>;

export async function generateMonthlyStatements(
  _prev: GenerateStatementsResult | null,
  formData: FormData,
): Promise<GenerateStatementsResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'generate-statements');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = GenerateStatementsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const result = await generateStatements({
      orgId: ctx.orgId,
      month: parsed.data.month,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: parsed.data.due_date,
    });
    log.adminAction(ctx.userId, 'generate_account_statements', 'account_statement');
    revalidatePath('/dashboard/account-statements');
    return ok(result);
  } catch (e) {
    log.error('[generateMonthlyStatements] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }
}
