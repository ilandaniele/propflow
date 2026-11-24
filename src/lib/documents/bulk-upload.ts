import type { ActionResult } from '@/lib/errors';
import { MAX_DOCUMENTS_PER_UPLOAD } from './types';

export type DocumentUploadFailure = 'invalid' | 'rateLimited' | 'failed';
export type DocumentUploadResult = { file: string; error?: DocumentUploadFailure };

type UploadOneDocument = (formData: FormData) => Promise<ActionResult>;

export function exceedsUploadLimit(fileCount: number): boolean {
  return fileCount > MAX_DOCUMENTS_PER_UPLOAD;
}

function failureFor(code: string): DocumentUploadFailure {
  if (code === 'VALIDATION_ERROR') return 'invalid';
  if (code === 'RATE_LIMITED') return 'rateLimited';
  return 'failed';
}

export async function uploadDocumentsSequentially(formData: FormData, upload: UploadOneDocument): Promise<DocumentUploadResult[]> {
  const files = formData.getAll('file').filter((value): value is File => value instanceof File);
  if (files.length > 1) formData.delete('name');

  const results: DocumentUploadResult[] = [];
  for (const file of files.slice(0, MAX_DOCUMENTS_PER_UPLOAD)) {
    formData.set('file', file);
    const result = await upload(formData);
    results.push(result.error ? { file: file.name, error: failureFor(result.error.code) } : { file: file.name });
  }
  return results;
}
