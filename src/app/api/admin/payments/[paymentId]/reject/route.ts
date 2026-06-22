/**
 * PATCH /api/admin/payments/[paymentId]/reject
 * Sets payment status to 'rejected' with an optional rejection note.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const BodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { paymentId } = await params;

  let body = {};
  try { body = await request.json(); } catch { /* no body is fine */ }
  const parsed = BodySchema.safeParse(body);
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;

  // Verify payment belongs to admin's org — AC8
  const existing = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.orgId)))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } }, { status: 404 });
  }

  // Build update — Drizzle (AC1)
  // NOTE: payments schema has no `notes` column; store reason in `reference` field.
  // TODO(W1/schema): add notes column to payments or confirm the correct field name.
  const setValues: Partial<typeof payments.$inferInsert> = { status: 'rejected' };
  if (reason) setValues.reference = reason;

  try {
    await db
      .update(payments)
      .set({ ...setValues, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.orgId)));
  } catch (err) {
    console.error('[api/admin/payments/reject PATCH]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reject payment.' } }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
