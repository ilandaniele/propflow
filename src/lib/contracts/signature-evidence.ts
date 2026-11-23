import { downloadFile } from '@/lib/storage';
import { sha256Hex } from '@/lib/whatsapp/dedupe';
import { log } from '@/lib/log';

export type SignatureEvidence = {
  signerEmail: string;
  sentAt: string;
  viewedAt: string | null;
  signedAt: string | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  documentSha256: string | null;
  signatureSha256: string | null;
};

export async function storedDocumentSha256(documentPath: string | null): Promise<string | null> {
  if (!documentPath) return null;
  try {
    return sha256Hex(await downloadFile('contracts', documentPath));
  } catch (e) {
    log.warn('[signature-evidence] contract PDF not hashed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function pngDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export { sha256Hex };
