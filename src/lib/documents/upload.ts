import type { documents } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { uploadFile } from '@/lib/storage';
import { DocumentFileSchema } from '@/lib/schemas/documents';
import { detectDocumentMime } from './mime';
import { documentStoragePath } from './queries';
import { DOCUMENT_MIME_EXTENSIONS, type DocumentCategory, type DocumentEntity } from './types';

export const DOCUMENTS_BUCKET = 'documents';

export type DocumentUploadFailure = 'size' | 'type' | 'storage';
export type DocumentUploadResult = { file: string; error?: DocumentUploadFailure };
type DocumentInsert = typeof documents.$inferInsert;
type StoredDocument = { row: DocumentInsert } | { error: DocumentUploadFailure };

export interface DocumentUploadTarget {
  orgId:           string;
  userId:          string;
  entity:          DocumentEntity;
  entityId:        string;
  category:        DocumentCategory;
  expiresOn:       string | null;
  visibleToTenant: boolean;
}

export function fileBaseName(fileName: string): string {
  return (fileName.replace(/\.[^.]*$/, '').trim() || fileName).slice(0, 120);
}

export function documentNameFor(fileName: string, typedName: string | undefined, fileCount: number): string {
  return fileCount === 1 && typedName ? typedName : fileBaseName(fileName);
}

export async function storeDocumentFile(target: DocumentUploadTarget, file: File, name: string): Promise<StoredDocument> {
  if (!DocumentFileSchema.safeParse(file).success) return { error: 'size' };

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = detectDocumentMime(bytes);
  if (!mimeType) return { error: 'type' };

  const id = crypto.randomUUID();
  const storagePath = documentStoragePath(target.orgId, id, DOCUMENT_MIME_EXTENSIONS[mimeType]);
  try {
    await uploadFile(DOCUMENTS_BUCKET, storagePath, bytes, mimeType);
  } catch (error) {
    log.error('document upload failed', { error: String(error) });
    return { error: 'storage' };
  }

  return {
    row: {
      id,
      orgId:           target.orgId,
      tenantId:        target.entity === 'tenant' ? target.entityId : null,
      contractId:      target.entity === 'contract' ? target.entityId : null,
      propertyId:      target.entity === 'property' ? target.entityId : null,
      name,
      category:        target.category,
      storagePath,
      mimeType,
      sizeBytes:       bytes.length,
      expiresOn:       target.expiresOn,
      visibleToTenant: target.visibleToTenant && target.entity !== 'property',
      uploadedBy:      target.userId,
    },
  };
}

export function uploadResults(files: File[], stored: StoredDocument[]): DocumentUploadResult[] {
  return files.map((file, index) => {
    const outcome = stored[index];
    return 'error' in outcome ? { file: file.name, error: outcome.error } : { file: file.name };
  });
}
