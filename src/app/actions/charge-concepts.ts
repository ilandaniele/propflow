'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chargeConcepts } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { SaveChargeConceptSchema } from '@/lib/schemas/charge-concept';

export async function saveChargeConcept(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'save-charge-concept');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveChargeConceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, description, code } = parsed.data;
  const values = { description, code, baseAmount: parsed.data.base_amount === null ? null : String(parsed.data.base_amount) };

  try {
    if (id) {
      const updated = await db
        .update(chargeConcepts)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(chargeConcepts.id, id), eq(chargeConcepts.orgId, ctx.orgId)))
        .returning({ id: chargeConcepts.id });
      if (!updated[0]) return Errors.NOT_FOUND();
    } else {
      await db.insert(chargeConcepts).values({ orgId: ctx.orgId, ...values });
    }
  } catch (e) {
    log.error('[saveChargeConcept] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, id ? 'update_charge_concept' : 'create_charge_concept', 'charge_concept');
  revalidatePath('/dashboard/charge-concepts');
  revalidatePath('/dashboard/payments');
  return ok(undefined);
}
