/**
 * PATCH /api/admin/payments/[paymentId]/reject
 * Sets payment status to 'pending' with a rejection note.
 * Note: 'rejected' is not in the CHECK constraint, so we reset to 'pending'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

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

  const admin = createAdminClient();

  const { data: payment, error: fetchErr } = await admin
    .from('payments')
    .select('id, org_id')
    .eq('id', paymentId)
    .eq('org_id', ctx.orgId)
    .single();

  if (fetchErr || !payment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } }, { status: 404 });
  }

  const updatePayload: Record<string, unknown> = { status: 'pending' };
  if (reason) updatePayload['notes'] = reason;

  const { error } = await admin
    .from('payments')
    .update(updatePayload)
    .eq('id', paymentId)
    .eq('org_id', ctx.orgId);

  if (error) {
    console.error('[api/admin/payments/reject PATCH]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reject payment.' } }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
