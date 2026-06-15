/**
 * PATCH /api/admin/payments/[paymentId]/reject
 * Sets payment status to 'rejected' with an optional rejection note.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments } from '@/lib/db/schema';

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

  // Verify ownership — org-scoped lookup
  const payment = await db.select({ id: payments.id, orgId: payments.orgId })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!payment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } }, { status: 404 });
  }

  try {
    await db.update(payments)
      .set({
        status:    'rejected',
        reference: reason ?? undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.orgId)));
  } catch (err) {
    console.error('[api/admin/payments/reject PATCH]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reject payment.' } }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
