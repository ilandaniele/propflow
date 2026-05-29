export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  const supabase = await createClient();

  // Load the receipt — must belong to this org (RLS + explicit check)
  // Tenant can only read their own uploads (enforced by RLS policy)
  const { data: receipt } = await supabase
    .from('receipt_uploads')
    .select('id, file_path, uploaded_by, org_id')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!receipt) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Tenant can only access their own receipts (defense in depth — RLS also enforces)
  if (ctx.role === 'tenant' && receipt.uploaded_by !== ctx.userId) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  const { data: urlData, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(receipt.file_path, SIGNED_URL_TTL_SECONDS);

  if (error || !urlData?.signedUrl) {
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  return NextResponse.json({ url: urlData.signedUrl });
}
