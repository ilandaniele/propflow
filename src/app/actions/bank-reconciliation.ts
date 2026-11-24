'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { parseStatement } from '@/lib/bank/parse-statement';
import {
  createPaymentFromLine,
  importBankLines,
  matchBankLine as saveMatch,
  setBankLineIgnored as saveIgnored,
} from '@/lib/bank/reconciliation';
import {
  CreatePaymentFromBankLineSchema,
  MatchBankLineSchema,
  MAX_STATEMENT_BYTES,
  SetBankLineIgnoredSchema,
} from '@/lib/schemas/bank';

type ImportSummary = { inserted: number; duplicates: number; skipped: number };

const revalidateReconciliation = () => {
  revalidatePath('/dashboard/payments/reconciliation');
  revalidatePath('/dashboard/payments');
};

type AdminContext =
  | { ctx: Awaited<ReturnType<typeof requireAdmin>>; error?: undefined }
  | { ctx?: undefined; error: ActionResult<never> };

async function adminContext(key: string): Promise<AdminContext> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return { error: Errors.UNAUTHORIZED() }; }
  if (!mutationRateLimit(ctx.userId, key).success) return { error: Errors.RATE_LIMITED() };
  return { ctx };
}

export async function importBankStatement(
  _prev: ActionResult<ImportSummary> | null,
  formData: FormData,
): Promise<ActionResult<ImportSummary>> {
  const auth = await adminContext('import-bank-statement');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return Errors.VALIDATION_ERROR({ fieldErrors: { file: ['Required'] } });
  if (file.size > MAX_STATEMENT_BYTES) return err('FILE_TOO_LARGE', 'Statement file is too large');

  const parsed = parseStatement(await file.text());
  if (parsed.status === 'no_header') return err('NO_HEADER', 'Could not find date, description and amount columns');
  if (parsed.status === 'too_many_rows') return err('TOO_MANY_ROWS', 'Statement has too many rows');

  const result = await importBankLines(ctx.orgId, ctx.userId, file.name, parsed.lines);
  log.adminAction(ctx.userId, 'import_bank_statement', 'bank_import', result.importId);
  revalidateReconciliation();
  return ok({ inserted: result.inserted, duplicates: result.duplicates, skipped: parsed.skipped });
}

export async function matchBankLine(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('match-bank-line');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = MatchBankLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await saveMatch(ctx.orgId, ctx.userId, parsed.data.line_id, parsed.data.payment_id);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'conflict') return Errors.CONFLICT('Line or payment is already reconciled');

  log.adminAction(ctx.userId, 'match_bank_line', 'bank_line', parsed.data.line_id);
  revalidateReconciliation();
  return ok(undefined);
}

export async function createPaymentFromBankLine(
  _prev: ActionResult<{ paymentId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ paymentId: string }>> {
  const auth = await adminContext('create-payment-from-bank-line');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = CreatePaymentFromBankLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await createPaymentFromLine(ctx.orgId, ctx.userId, parsed.data.line_id, parsed.data.contract_id);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'conflict') return Errors.CONFLICT('Line is already reconciled');

  log.adminAction(ctx.userId, 'create_payment_from_bank_line', 'payment', result.paymentId);
  revalidateReconciliation();
  return ok({ paymentId: result.paymentId });
}

export async function setBankLineIgnored(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('ignore-bank-line');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = SetBankLineIgnoredSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await saveIgnored(ctx.orgId, ctx.userId, parsed.data.line_id, parsed.data.ignored))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, parsed.data.ignored ? 'ignore_bank_line' : 'unignore_bank_line', 'bank_line', parsed.data.line_id);
  revalidateReconciliation();
  return ok(undefined);
}
