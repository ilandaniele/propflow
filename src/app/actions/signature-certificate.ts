'use server';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, organizations, properties, tenants, units } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { generatePdfRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { downloadFile } from '@/lib/storage';
import { SignatureCertificateSchema } from '@/lib/schemas/contractDoc';
import { signedRequest } from '@/lib/contracts/signature-requests';
import { orgSignature } from '@/lib/contracts/org-signature';
import { pngDataUrl } from '@/lib/contracts/signature-evidence';
import type { CertificateSource } from '@/lib/contracts/certificate';

export async function getSignatureCertificateSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult<CertificateSource>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!generatePdfRateLimit(ctx.userId).success) return Errors.RATE_LIMITED();

  const parsed = SignatureCertificateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const request = await signedRequest(ctx.orgId, parsed.data.signature_request_id);
  if (!request) return Errors.NOT_FOUND();

  const [[contract], landlord] = await Promise.all([
    db
      .select({
        contractCode: contracts.contractCode,
        startDate:    contracts.startDate,
        endDate:      contracts.endDate,
        tenantName:   tenants.fullName,
        unitLabel:    units.label,
        propertyName: properties.name,
        orgName:      organizations.name,
      })
      .from(contracts)
      .innerJoin(organizations, eq(organizations.id, contracts.orgId))
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(and(eq(contracts.id, request.contractId), eq(contracts.orgId, ctx.orgId)))
      .limit(1),
    orgSignature(ctx.orgId),
  ]);
  if (!contract) return Errors.NOT_FOUND();

  let tenantSignature: string | null = null;
  if (request.imagePath?.startsWith(`${ctx.orgId}/`)) {
    try {
      tenantSignature = pngDataUrl(await downloadFile('contracts', request.imagePath));
    } catch (e) {
      log.warn('[signatureCertificate] tenant signature not loaded', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return ok({
    contract: {
      code:     contract.contractCode,
      orgName:  contract.orgName,
      tenant:   contract.tenantName ?? '',
      property: [contract.propertyName, contract.unitLabel].filter(Boolean).join(' · '),
      term:     [contract.startDate, contract.endDate].filter(Boolean).join(' → '),
    },
    evidence: request.evidence,
    tenantSignature,
    landlord,
  });
}
