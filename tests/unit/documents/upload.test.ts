import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = vi.hoisted(() => ({ fail: false, uploaded: [] as string[] }));
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async (_bucket: string, path: string) => {
    if (storage.fail) throw new Error('r2 down');
    storage.uploaded.push(path);
  }),
}));
vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }));

import { documentNameFor, fileBaseName, storeDocumentFile, type DocumentUploadTarget } from '@/lib/documents/upload';
import { exceedsUploadLimit, uploadDocumentsSequentially } from '@/lib/documents/bulk-upload';
import { UploadDocumentSchema } from '@/lib/schemas/documents';
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_UPLOAD } from '@/lib/documents/types';
import type { ActionResult } from '@/lib/errors';

const PDF = Buffer.from('%PDF-1.7 unit document');
const ENTITY_ID = '7f3c2a7e-4b1d-4c55-9a2e-1f0e6d3b8a91';
const target: DocumentUploadTarget = {
  orgId: 'org-1',
  userId: 'user-1',
  entity: 'property',
  entityId: ENTITY_ID,
  category: 'other',
  expiresOn: null,
  visibleToTenant: true,
};

const pdf = (name = 'lease.pdf') => new File([PDF], name, { type: 'application/pdf' });

beforeEach(() => {
  storage.fail = false;
  storage.uploaded = [];
});

describe('document names', () => {
  it('strips the extension from the file name', () => {
    expect(fileBaseName('Contrato 2026.final.pdf')).toBe('Contrato 2026.final');
    expect(fileBaseName('.pdf')).toBe('.pdf');
    expect(fileBaseName(`${'a'.repeat(200)}.pdf`)).toHaveLength(120);
  });

  it('prefers the typed name and falls back to the file name', () => {
    expect(documentNameFor('dni.pdf', 'DNI titular')).toBe('DNI titular');
    expect(documentNameFor('dni.pdf', undefined)).toBe('dni');
    expect(documentNameFor('dni.pdf', '')).toBe('dni');
  });
});

describe('UploadDocumentSchema', () => {
  const parse = (file: File, extra: Record<string, string> = {}) =>
    UploadDocumentSchema.safeParse({ entity_type: 'tenant', entity_id: ENTITY_ID, category: 'other', file, ...extra });

  it('accepts one file with or without a name', () => {
    expect(parse(pdf()).success).toBe(true);
    expect(parse(pdf(), { name: 'Lease' }).success).toBe(true);
  });

  it('rejects empty and oversized files', () => {
    expect(parse(new File([], 'empty.pdf')).success).toBe(false);
    expect(parse(new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'big.pdf')).success).toBe(false);
  });
});

describe('storeDocumentFile', () => {
  it('stores a valid PDF and builds its row under the org prefix', async () => {
    const outcome = await storeDocumentFile(target, pdf(), 'Lease');

    expect('row' in outcome).toBe(true);
    if (!('row' in outcome)) return;
    expect(outcome.row).toMatchObject({
      orgId: 'org-1',
      propertyId: ENTITY_ID,
      tenantId: null,
      name: 'Lease',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      visibleToTenant: false,
      uploadedBy: 'user-1',
    });
    expect(outcome.row.storagePath).toBe(`org-1/documents/${outcome.row.id}.pdf`);
    expect(storage.uploaded).toEqual([outcome.row.storagePath]);
  });

  it('reports type and storage failures', async () => {
    expect(await storeDocumentFile(target, new File([Buffer.from('MZ binary')], 'x.pdf'), 'x')).toEqual({ error: 'type' });
    expect(storage.uploaded).toHaveLength(0);

    storage.fail = true;
    expect(await storeDocumentFile(target, pdf(), 'x')).toEqual({ error: 'storage' });
  });
});

describe('uploadDocumentsSequentially', () => {
  function formWith(files: File[]) {
    const data = new FormData();
    data.set('name', 'Typed');
    data.set('category', 'other');
    for (const file of files) data.append('file', file);
    return data;
  }

  it('sends one file per request in order, drops the typed name for several files and maps failures', async () => {
    const sent: Array<{ file: string; name: FormDataEntryValue | null; files: number }> = [];
    const replies: ActionResult[] = [{}, { error: { code: 'VALIDATION_ERROR', message: '' } }, { error: { code: 'RATE_LIMITED', message: '' } }, { error: { code: 'INTERNAL_ERROR', message: '' } }];
    const upload = vi.fn(async (data: FormData) => {
      sent.push({ file: (data.get('file') as File).name, name: data.get('name'), files: data.getAll('file').length });
      return replies[sent.length - 1];
    });

    const results = await uploadDocumentsSequentially(formWith([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf')]), upload);

    expect(sent).toEqual([
      { file: 'a.pdf', name: null, files: 1 },
      { file: 'b.pdf', name: null, files: 1 },
      { file: 'c.pdf', name: null, files: 1 },
      { file: 'd.pdf', name: null, files: 1 },
    ]);
    expect(results).toEqual([
      { file: 'a.pdf' },
      { file: 'b.pdf', error: 'invalid' },
      { file: 'c.pdf', error: 'rateLimited' },
      { file: 'd.pdf', error: 'failed' },
    ]);
  });

  it('keeps the typed name for a single file', async () => {
    const upload = vi.fn(async (data: FormData) => {
      expect(data.get('name')).toBe('Typed');
      return {};
    });
    expect(await uploadDocumentsSequentially(formWith([pdf()]), upload)).toEqual([{ file: 'lease.pdf' }]);
  });

  it('never sends more than the max file count', async () => {
    const upload = vi.fn(async () => ({}));
    const files = Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD + 2 }, (_, i) => pdf(`${i}.pdf`));

    expect(await uploadDocumentsSequentially(formWith(files), upload)).toHaveLength(MAX_DOCUMENTS_PER_UPLOAD);
    expect(upload).toHaveBeenCalledTimes(MAX_DOCUMENTS_PER_UPLOAD);
    expect(exceedsUploadLimit(MAX_DOCUMENTS_PER_UPLOAD)).toBe(false);
    expect(exceedsUploadLimit(MAX_DOCUMENTS_PER_UPLOAD + 1)).toBe(true);
  });

  it('fits a full batch inside the per-user documents mutation rate limit', async () => {
    const { mutationRateLimit } = await import('@/lib/ratelimit');
    const userId = `bulk-${crypto.randomUUID()}`;
    const batch = Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD }, () => mutationRateLimit(userId, 'documents').success);
    expect(batch.every(Boolean)).toBe(true);
  });
});
