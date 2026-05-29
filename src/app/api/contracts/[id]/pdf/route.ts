import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';

const SIGNED_URL_TTL_SECONDS = 3600;

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

  // Load the contract — must belong to this org
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, org_id, document_url, tenant_id')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  // IDOR: always 404, never 403 (no resource enumeration)
  if (!contract) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (!contract.document_url) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Tenant: must be the contract's own tenant
  if (ctx.role === 'tenant') {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('id')
      .eq('profile_id', ctx.userId)
      .eq('id', contract.tenant_id)
      .single();

    if (!tenantRow) {
      return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
    }
  }

  const { data: urlData, error } = await supabase.storage
    .from('contracts')
    .createSignedUrl(contract.document_url, SIGNED_URL_TTL_SECONDS);

  if (error || !urlData?.signedUrl) {
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  return NextResponse.json({ url: urlData.signedUrl });
}
