import { sniffMimeType } from '@/lib/storage/mime-sniff';
import { hasPdfSignature } from '@/lib/contracts/pdf-bytes';
import { DOCUMENT_MIME_EXTENSIONS, type DocumentMime } from './types';

export function detectDocumentMime(bytes: Buffer): DocumentMime | null {
  if (hasPdfSignature(bytes)) return 'application/pdf';
  const sniffed = sniffMimeType(bytes);
  return sniffed && sniffed in DOCUMENT_MIME_EXTENSIONS ? (sniffed as DocumentMime) : null;
}
