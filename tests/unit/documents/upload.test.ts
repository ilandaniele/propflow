import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = vi.hoisted(() => ({ fail: false, uploaded: [] as string[] }));
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async (_bucket: string, path: string) => {
    if (storage.fail) throw new Error('r2 down');
    storage.uploaded.push(path);
  }),
}));
vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }));

import { documentNameFor, fileBaseName, storeDocumentFile, uploadResults, type DocumentUploadTarget } from '@/lib/documents/upload';
import { UploadDocumentsSchema } from '@/lib/schemas/documents';
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_UPLOAD } from '@/lib/documents/types';

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
const sized = (bytes: number, name = 'big.pdf') => new File([new Uint8Array(bytes)], name);

function parse(files: File[], extra: Record<string, string> = {}) {
  return UploadDocumentsSchema.safeParse({ entity_type: 'tenant', entity_id: ENTITY_ID, category: 'other', files, ...extra });
}

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

  it('uses the typed name for one file and each file name for several', () => {
    expect(documentNameFor('dni.pdf', 'DNI titular', 1)).toBe('DNI titular');
    expect(documentNameFor('dni.pdf', undefined, 1)).toBe('dni');
    expect(documentNameFor('dni.pdf', 'DNI titular', 2)).toBe('dni');
  });
});

describe('UploadDocumentsSchema', () => {
  it('accepts several files without a name', () => {
    expect(parse([pdf('a.pdf'), pdf('b.pdf')]).success).toBe(true);
  });

  it('requires a name for a single file', () => {
    expect(parse([pdf()]).success).toBe(false);
    expect(parse([pdf()], { name: 'Lease' }).success).toBe(true);
  });

  it('rejects no files and more than the max count', () => {
    expect(parse([]).success).toBe(false);
    const tooMany = Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD + 1 }, (_, i) => pdf(`${i}.pdf`));
    expect(parse(tooMany).success).toBe(false);
  });

  it('rejects a selection over the total size cap', () => {
    const files = Array.from({ length: 5 }, (_, i) => sized(MAX_DOCUMENT_BYTES, `${i}.pdf`));
    expect(parse(files).success).toBe(false);
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

  it('reports size, type and storage failures without writing', async () => {
    expect(await storeDocumentFile(target, sized(0, 'empty.pdf'), 'x')).toEqual({ error: 'size' });
    expect(await storeDocumentFile(target, sized(MAX_DOCUMENT_BYTES + 1), 'x')).toEqual({ error: 'size' });
    expect(await storeDocumentFile(target, new File([Buffer.from('MZ binary')], 'x.pdf'), 'x')).toEqual({ error: 'type' });
    expect(storage.uploaded).toHaveLength(0);

    storage.fail = true;
    expect(await storeDocumentFile(target, pdf(), 'x')).toEqual({ error: 'storage' });
  });

  it('maps outcomes back to file names in order', () => {
    const files = [pdf('ok.pdf'), pdf('bad.pdf')];
    expect(uploadResults(files, [{ row: { id: '1' } as never }, { error: 'type' }])).toEqual([
      { file: 'ok.pdf' },
      { file: 'bad.pdf', error: 'type' },
    ]);
  });
});
