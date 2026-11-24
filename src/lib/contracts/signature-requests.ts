import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { signatureRequests } from '@/lib/db/schema';
import type { SignatureEvidence } from './signature-evidence';

export type SignatureRequestRow = SignatureEvidence & { id: string; status: string };

const evidenceColumns = {
  signerEmail:     signatureRequests.signerEmail,
  sentAt:          signatureRequests.sentAt,
  viewedAt:        signatureRequests.viewedAt,
  signedAt:        signatureRequests.signedAt,
  signedIp:        signatureRequests.signedIp,
  signedUserAgent: signatureRequests.signedUserAgent,
  documentSha256:  signatureRequests.documentSha256,
  signatureSha256: signatureRequests.signatureSha256,
};

function toEvidence(row: {
  signerEmail: string; sentAt: Date; viewedAt: Date | null; signedAt: Date | null;
  signedIp: string | null; signedUserAgent: string | null; documentSha256: string | null; signatureSha256: string | null;
}): SignatureEvidence {
  return {
    ...row,
    sentAt:   row.sentAt.toISOString(),
    viewedAt: row.viewedAt?.toISOString() ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
  };
}

export async function listContractSignatureRequests(orgId: string, contractId: string): Promise<SignatureRequestRow[]> {
  const rows = await db
    .select({ id: signatureRequests.id, status: signatureRequests.status, ...evidenceColumns })
    .from(signatureRequests)
    .where(and(eq(signatureRequests.orgId, orgId), eq(signatureRequests.contractId, contractId)))
    .orderBy(desc(signatureRequests.createdAt))
    .limit(20);
  return rows.map(({ id, status, ...rest }) => ({ id, status, ...toEvidence(rest) }));
}

export async function signedRequest(orgId: string, signatureRequestId: string) {
  const [row] = await db
    .select({ contractId: signatureRequests.contractId, imagePath: signatureRequests.signatureImagePath, ...evidenceColumns })
    .from(signatureRequests)
    .where(and(
      eq(signatureRequests.id, signatureRequestId),
      eq(signatureRequests.orgId, orgId),
      eq(signatureRequests.status, 'signed'),
    ))
    .limit(1);
  if (!row) return null;
  const { contractId, imagePath, ...evidence } = row;
  return { contractId, imagePath, evidence: toEvidence(evidence) };
}
