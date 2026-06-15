/**
 * PATCH /api/admin/payments/[paymentId]/approve
 * Sets payment status to 'approved'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments } from '@/lib/db/schema';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { paymentId } = await params;

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
      .set({ status: 'approved', approvedAt: new Date(), approvedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.orgId)));
  } catch (err) {
    console.error('[api/admin/payments/approve PATCH]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to approve payment.' } }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
