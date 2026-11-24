'use server';

import { requireAdmin } from '@/lib/auth/guards';
import { generatePdfRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { downloadFile } from '@/lib/storage';
import { SignatureCertificateSchema } from '@/lib/schemas/contractDoc';
import { signedRequest } from '@/lib/contracts/signature-requests';
import { orgSignature } from '@/lib/contracts/org-signature';
import { contractHeader } from '@/lib/contracts/contract-header';
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

  const [contract, landlord] = await Promise.all([
    contractHeader(ctx.orgId, request.contractId),
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
    contract,
    evidence: request.evidence,
    tenantSignature,
    landlord,
  });
}
