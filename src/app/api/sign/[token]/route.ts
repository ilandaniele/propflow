export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signatureRequests, contracts, tenants, units, properties, handoverActs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Errors } from '@/lib/errors';
import { uploadFile, getSignedUrl } from '@/lib/storage';
import { storedDocumentSha256, sha256Hex } from '@/lib/contracts/signature-evidence';
import { SignSubmitSchema } from '@/lib/schemas/contractDoc';
import { getClientIp, signatureRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { handoverSignaturePath } from '@/lib/contracts/handover';

async function signedDocumentFor(handoverActId: string | null) {
  if (!handoverActId) return null;
  const [act] = await db
    .select({ kind: handoverActs.kind, documentPath: handoverActs.documentPath })
    .from(handoverActs)
    .where(eq(handoverActs.id, handoverActId))
    .limit(1);
  return act ?? null;
}

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
      handoverActId: signatureRequests.handoverActId,
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
      documentUrl:     contracts.documentUrl,
    })
    .from(contracts)
    .leftJoin(units, eq(contracts.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .leftJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.id, sigReq.contractId))
    .limit(1);

  const contract = contractRows[0];
  const act = await signedDocumentFor(sigReq.handoverActId);
  const documentPath = sigReq.handoverActId ? act?.documentPath ?? null : contract?.documentUrl ?? null;
  const documentLink = documentPath
    ? await getSignedUrl('contracts', documentPath, 900).catch(() => null)
    : null;

  return NextResponse.json({
    documentLink,
    documentKind: act?.kind ?? 'contract',
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

async function signedDocumentPath(sigReq: { orgId: string; contractId: string; handoverActId: string | null }) {
  if (sigReq.handoverActId) {
    const [act] = await db
      .select({ documentPath: handoverActs.documentPath })
      .from(handoverActs)
      .where(and(eq(handoverActs.id, sigReq.handoverActId), eq(handoverActs.orgId, sigReq.orgId)))
      .limit(1);
    return act?.documentPath ?? null;
  }
  const [contract] = await db
    .select({ documentUrl: contracts.documentUrl })
    .from(contracts)
    .where(and(eq(contracts.id, sigReq.contractId), eq(contracts.orgId, sigReq.orgId)))
    .limit(1);
  return contract?.documentUrl ?? null;
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
  const ip = getClientIp(request);
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
      handoverActId: signatureRequests.handoverActId,
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
  const signaturePath = sigReq.handoverActId
    ? handoverSignaturePath(sigReq.orgId, sigReq.contractId, sigReq.handoverActId)
    : `${sigReq.orgId}/${sigReq.contractId}/signature.png`;

  try {
    await uploadFile('contracts', signaturePath, imageBytes, 'image/png', true);
  } catch (err) {
    log.error('[sign] signature image upload error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  const documentSha256 = await storedDocumentSha256(await signedDocumentPath(sigReq));
  const signatureSha256 = sha256Hex(imageBytes);

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
      documentSha256,
      signatureSha256,
      updatedAt: now,
    })
    .where(eq(signatureRequests.id, sigReq.id));

  if (sigReq.handoverActId) {
    await db
      .update(handoverActs)
      .set({ status: 'signed', signedAt: now, updatedAt: now })
      .where(and(eq(handoverActs.id, sigReq.handoverActId), eq(handoverActs.orgId, sigReq.orgId)));
    log.info('[sign] handover act signed', { sigRequestId: sigReq.id, handoverActId: sigReq.handoverActId });
    return NextResponse.json({ status: 'signed', signedAt: now.toISOString(), documentSha256 });
  }

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
  return NextResponse.json({ status: 'signed', signedAt: now.toISOString(), documentSha256 });
}
