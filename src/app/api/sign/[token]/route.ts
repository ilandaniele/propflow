import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Errors } from '@/lib/errors';
import { SignSubmitSchema } from '@/lib/schemas/contractDoc';
import { signatureRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';

/** GET /api/sign/[token] — public, no session; validates token, marks viewed */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  if (!token || typeof token !== 'string') {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  const admin = createAdminClient();

  // Load the signature request by token — service-role, scoped to token
  const { data: sigReq } = await admin
    .from('signature_requests')
    .select(`
      id, status, expires_at, signer_email,
      contract:contracts(id, org_id, start_date, end_date, monthly_rent,
        tenant:tenants(full_name),
        unit:units(label, property:properties(name, address))
      )
    `)
    .eq('token', token)
    .single();

  // Invalid/expired/missing: always 404 (no enumeration — IC-B2)
  if (!sigReq) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (new Date(sigReq.expires_at) < new Date()) {
    // Mark expired but still 404 to avoid leaking state
    await admin.from('signature_requests').update({ status: 'expired' }).eq('id', sigReq.id);
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (sigReq.status === 'signed' || sigReq.status === 'declined') {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Mark as viewed
  if (sigReq.status === 'sent') {
    await admin.from('signature_requests').update({
      status: 'viewed',
      viewed_at: new Date().toISOString(),
    }).eq('id', sigReq.id);
  }

  // Return minimal contract preview (no PII beyond what the signer already knows)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = sigReq.contract as any;
  return NextResponse.json({
    sigRequestId: sigReq.id,
    expiresAt: sigReq.expires_at,
    contract: {
      startDate: contract?.start_date,
      endDate: contract?.end_date,
      monthlyRent: contract?.monthly_rent,
      unitLabel: contract?.unit?.label,
      propertyName: contract?.unit?.property?.name,
      propertyAddress: contract?.unit?.property?.address,
      tenantName: contract?.tenant?.full_name,
    },
  });
}

/** POST /api/sign/[token] — public, no session; submit signature */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  if (!token || typeof token !== 'string') {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Rate limit: 5/min per token+IP (prevent brute-force)
  const xff = request.headers.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0].trim() : 'anonymous';
  const rl = signatureRateLimit(token, ip);
  if (!rl.success) {
    return NextResponse.json(Errors.RATE_LIMITED(), { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(Errors.VALIDATION_ERROR({ formErrors: ['Invalid JSON'], fieldErrors: {} }), { status: 400 });
  }
  const parsed = SignSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(Errors.VALIDATION_ERROR(parsed.error.flatten()), { status: 400 });
  }

  const admin = createAdminClient();

  // Load token — must be sent/viewed, not expired
  const { data: sigReq } = await admin
    .from('signature_requests')
    .select('id, status, expires_at, contract_id, org_id')
    .eq('token', token)
    .single();

  if (!sigReq) return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });

  if (new Date(sigReq.expires_at) < new Date()) {
    await admin.from('signature_requests').update({ status: 'expired' }).eq('id', sigReq.id);
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (sigReq.status === 'signed') {
    // Token is single-use — second attempt is a conflict
    return NextResponse.json(
      { error: { code: 'ALREADY_SIGNED', message: 'This contract has already been signed.' } },
      { status: 409 }
    );
  }

  if (sigReq.status === 'declined' || sigReq.status === 'expired') {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Store signature image to contracts bucket: org_id/contract_id/signature.png
  // Strip the data URL header
  const base64Data = parsed.data.signature_image_base64.replace(/^data:image\/png;base64,/, '');
  const imageBytes = Buffer.from(base64Data, 'base64');
  const signaturePath = `${sigReq.org_id}/${sigReq.contract_id}/signature.png`;

  const { error: uploadError } = await admin.storage
    .from('contracts')
    .upload(signaturePath, imageBytes, { contentType: 'image/png', upsert: true });

  if (uploadError) {
    log.error('[sign] signature image upload error', { error: uploadError.message });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  const now = new Date().toISOString();
  const userAgent = request.headers.get('user-agent') ?? '';

  // Update signature_request — all mutations via service-role scoped to this token's record
  await admin.from('signature_requests').update({
    status: 'signed',
    signed_at: now,
    signed_ip: ip,
    signed_user_agent: userAgent.slice(0, 512),
    signature_image_path: signaturePath,
    updated_at: now,
  }).eq('id', sigReq.id);

  // Flip contract.signature_status = 'signed' and signed_at
  await admin.from('contracts').update({
    signature_status: 'signed',
    signed_at: now,
    updated_at: now,
  }).eq('id', sigReq.contract_id);

  log.info('[sign] contract signed', { sigRequestId: sigReq.id, contractId: sigReq.contract_id });
  return NextResponse.json({ status: 'signed' });
}
