import { ALLOWED_MIME_TYPES, getSignedUrl, uploadFile, validateImageFile } from '@/lib/storage';
import { isSafeOrgScopedPath } from '@/lib/storage/path';

export const APPLICATION_BUCKET = 'rental-applications';
export const MAX_APPLICATION_DOCUMENTS = 3;
export const MAX_APPLICATION_DOCUMENT_BYTES = 1_900_000;
export const APPLICATION_DOCUMENT_MIME_TYPES = [...ALLOWED_MIME_TYPES, 'application/pdf'] as const;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, i) => buffer[i] === byte);
}

export function isValidApplicationDocument(buffer: Buffer, declaredMime: string): boolean {
  if (declaredMime !== 'application/pdf') return validateImageFile(buffer, declaredMime, MAX_APPLICATION_DOCUMENT_BYTES).valid;
  return buffer.byteLength <= MAX_APPLICATION_DOCUMENT_BYTES && isPdf(buffer);
}

export function applicationDocumentPath(orgId: string, applicationId: string, mime: string): string {
  return `${orgId}/applications/${applicationId}/${crypto.randomUUID()}.${EXTENSIONS[mime]}`;
}

export type DocumentUpload = { buffer: Buffer; mime: string; name: string };

export async function readDocumentUploads(files: File[]): Promise<DocumentUpload[] | null> {
  if (files.length > MAX_APPLICATION_DOCUMENTS) return null;
  const uploads = await Promise.all(files.map(async (file) => ({
    buffer: Buffer.from(await file.arrayBuffer()),
    mime: file.type,
    name: file.name.slice(0, 120),
  })));
  return uploads.every((upload) => isValidApplicationDocument(upload.buffer, upload.mime)) ? uploads : null;
}

export async function storeDocumentUploads(orgId: string, applicationId: string, uploads: DocumentUpload[]) {
  return Promise.all(uploads.map(async (upload) => {
    const path = applicationDocumentPath(orgId, applicationId, upload.mime);
    await uploadFile(APPLICATION_BUCKET, path, upload.buffer, upload.mime);
    return { path, mime: upload.mime, name: upload.name };
  }));
}

export async function signedDocumentLinks(orgId: string, documents: { path: string; name: string }[]) {
  const safe = documents.filter((doc) => isSafeOrgScopedPath(doc.path, orgId));
  return Promise.all(safe.map(async (doc) => ({ name: doc.name, url: await getSignedUrl(APPLICATION_BUCKET, doc.path) })));
}
