import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { orgSignatures } from '@/lib/db/schema';
import { validateImageFile } from '@/lib/storage';
import { PNG_DATA_URL_PREFIX, type OrgSignatureInput } from '@/lib/schemas/contractDoc';

const MAX_SIGNATURE_IMAGE_BYTES = 150_000;

export type OrgSignature = { signerName: string; signerDocument: string | null; imageDataUrl: string };

export function isValidSignatureImage(dataUrl: string): boolean {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return false;
  const buffer = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  return validateImageFile(buffer, 'image/png', MAX_SIGNATURE_IMAGE_BYTES).valid;
}

export async function orgSignature(orgId: string): Promise<OrgSignature | null> {
  const [row] = await db
    .select({ signerName: orgSignatures.signerName, signerDocument: orgSignatures.signerDocument, imageDataUrl: orgSignatures.imageDataUrl })
    .from(orgSignatures)
    .where(eq(orgSignatures.orgId, orgId))
    .limit(1);
  return row ?? null;
}

export async function upsertOrgSignature(orgId: string, input: OrgSignatureInput): Promise<void> {
  const values = {
    signerName: input.signer_name,
    signerDocument: input.signer_document || null,
    imageDataUrl: input.signature_image,
    updatedAt: new Date(),
  };
  await db
    .insert(orgSignatures)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: orgSignatures.orgId, set: values });
}
