import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, properties, signatureRequests, tenants, units } from '@/lib/db/schema';
import { sendEmail, buildSignatureRequestEmail } from '@/lib/notifications/email';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

const SIGNATURE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type DispatchResult = { id: string } | { error: 'no_email' | 'insert_failed' };

/** Creates a signature request for the contract's tenant and emails the signing link. */
export async function dispatchSignatureRequest(
  orgId: string,
  contractId: string,
  handoverActId: string | null = null,
): Promise<DispatchResult> {
  const [signer] = await db
    .select({
      fullName:        tenants.fullName,
      email:           tenants.email,
      profileId:       tenants.profileId,
      propertyName:    properties.name,
      propertyAddress: properties.address,
    })
    .from(contracts)
    .innerJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, orgId)))
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, orgId)))
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .limit(1);
  if (!signer?.email) return { error: 'no_email' };

  const expiresAt = new Date(Date.now() + SIGNATURE_TTL_MS);
  let request: { id: string; token: string } | undefined;
  try {
    [request] = await db
      .insert(signatureRequests)
      .values({
        orgId,
        contractId,
        handoverActId,
        signerProfileId: signer.profileId ?? null,
        signerEmail:     signer.email,
        expiresAt,
        status:          'sent',
      })
      .returning({ id: signatureRequests.id, token: signatureRequests.token });
  } catch (e) {
    log.error('[dispatchSignatureRequest] insert error', { code: e instanceof Error ? e.message : String(e) });
  }
  if (!request) return { error: 'insert_failed' };

  const emailResult = await sendEmail({
    to: signer.email,
    ...buildSignatureRequestEmail({
      signerName:      signer.fullName ?? 'Tenant',
      propertyAddress: signer.propertyAddress ?? signer.propertyName ?? 'your rental',
      signUrl:         `${env.NEXT_PUBLIC_SITE_URL}/sign/${request.token}`,
      expiresAt,
    }),
    context: 'signature_request',
  });
  if (!emailResult.success) log.warn('[dispatchSignatureRequest] email send failed', { sigRequestId: request.id });

  return { id: request.id };
}
