/**
 * PATCH /api/admin/payments/[paymentId]/approve
 * Sets payment status to 'approved'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { paymentId } = await params;
  const admin = createAdminClient();

  // Verify ownership
  const { data: payment, error: fetchErr } = await admin
    .from('payments')
    .select('id, org_id')
    .eq('id', paymentId)
    .eq('org_id', ctx.orgId)
    .single();

  if (fetchErr || !payment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } }, { status: 404 });
  }

  const { error } = await admin
    .from('payments')
    .update({ status: 'approved' })
    .eq('id', paymentId)
    .eq('org_id', ctx.orgId);

  if (error) {
    console.error('[api/admin/payments/approve PATCH]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to approve payment.' } }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
