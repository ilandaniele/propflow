export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signatureRequests, contracts, tenants, units, properties } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Errors } from '@/lib/errors';
import { uploadFile } from '@/lib/storage';
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

  // Load the signature request by token — Drizzle (AC1)
  const sigReqRows = await db
    .select({
      id:          signatureRequests.id,
      status:      signatureRequests.status,
      expiresAt:   signatureRequests.expiresAt,
      signerEmail: signatureRequests.signerEmail,
      contractId:  signatureRequests.contractId,
    })
    .from(signatureRequests)
    .where(eq(signatureRequests.token, token))
    .limit(1);

  const sigReq = sigReqRows[0];

  // Invalid/expired/missing: always 404 (no enumeration — IC-B2)
  if (!sigReq) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (new Date(sigReq.expiresAt) < new Date()) {
    // Mark expired but still 404 to avoid leaking state
    await db
      .update(signatureRequests)
      .set({ status: 'expired' })
      .where(eq(signatureRequests.id, sigReq.id));
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (sigReq.status === 'signed' || sigReq.status === 'declined') {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Mark as viewed — Drizzle (AC1)
  if (sigReq.status === 'sent') {
    await db
      .update(signatureRequests)
      .set({ status: 'viewed', viewedAt: new Date() })
      .where(eq(signatureRequests.id, sigReq.id));
  }

  // Fetch contract + unit + property + tenant for preview — Drizzle (AC1)
  const contractRows = await db
    .select({
      startDate:       contracts.startDate,
      endDate:         contracts.endDate,
      monthlyRent:     contracts.monthlyRent,
      unitLabel:       units.label,
      propertyName:    properties.name,
      propertyAddress: properties.address,
      tenantFullName:  tenants.fullName,
    })
    .from(contracts)
    .leftJoin(units, eq(contracts.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .leftJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.id, sigReq.contractId))
    .limit(1);

  const contract = contractRows[0];

  return NextResponse.json({
    sigRequestId: sigReq.id,
    expiresAt: sigReq.expiresAt,
    contract: {
      startDate:       contract?.startDate,
      endDate:         contract?.endDate,
      monthlyRent:     contract?.monthlyRent,
      unitLabel:       contract?.unitLabel,
      propertyName:    contract?.propertyName,
      propertyAddress: contract?.propertyAddress,
      tenantName:      contract?.tenantFullName,
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

  // Load token — must be sent/viewed, not expired — Drizzle (AC1)
  const sigReqRows = await db
    .select({
      id:         signatureRequests.id,
      status:     signatureRequests.status,
      expiresAt:  signatureRequests.expiresAt,
      contractId: signatureRequests.contractId,
      orgId:      signatureRequests.orgId,
    })
    .from(signatureRequests)
    .where(eq(signatureRequests.token, token))
    .limit(1);

  const sigReq = sigReqRows[0];
  if (!sigReq) return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });

  if (new Date(sigReq.expiresAt) < new Date()) {
    await db
      .update(signatureRequests)
      .set({ status: 'expired' })
      .where(eq(signatureRequests.id, sigReq.id));
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
  const signaturePath = `${sigReq.orgId}/${sigReq.contractId}/signature.png`;

  try {
    await uploadFile('contracts', signaturePath, imageBytes, 'image/png', true);
  } catch (err) {
    log.error('[sign] signature image upload error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  const now = new Date();
  const userAgent = request.headers.get('user-agent') ?? '';

  // Update signature_request — Drizzle (AC1), scoped to this token's record
  await db
    .update(signatureRequests)
    .set({
      status: 'signed',
      signedAt: now,
      signedIp: ip,
      signedUserAgent: userAgent.slice(0, 512),
      signatureImagePath: signaturePath,
      updatedAt: now,
    })
    .where(eq(signatureRequests.id, sigReq.id));

  // Flip contract.signature_status = 'signed' and signed_at — Drizzle (AC1).
  // Defense-in-depth: scope the update to the signature request's org so a
  // contract id can never be flipped outside the token's own organization.
  await db
    .update(contracts)
    .set({
      signatureStatus: 'signed',
      signedAt: now,
      updatedAt: now,
    })
    .where(and(eq(contracts.id, sigReq.contractId), eq(contracts.orgId, sigReq.orgId)));

  log.info('[sign] contract signed', { sigRequestId: sigReq.id, contractId: sigReq.contractId });
  return NextResponse.json({ status: 'signed' });
}
