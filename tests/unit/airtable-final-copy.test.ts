/**
 * Unit tests for the one-off Airtable attachment copy (src/lib/airtable-final).
 * fetch, the DB store, the manifest and uploadFile are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ATTACHMENT_COLUMNS } from '@/lib/airtable-final/fields';
import {
  archivePath,
  buildCopyPath,
  extractSnapshotAttachments,
  isAirtableUrl,
  sniffCopyMime,
} from '@/lib/airtable-final/attachments';

const store = vi.hoisted(() => ({
  listPendingColumnRows: vi.fn(),
  countPendingColumnRows: vi.fn(),
  setColumnValue: vi.fn(),
  listSnapshotRows: vi.fn(),
  findUnitIds: vi.fn(),
  insertUnitImage: vi.fn(),
}));
const manifestApi = vi.hoisted(() => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/airtable-final/store', () => store);
vi.mock('@/lib/airtable-final/manifest', () => manifestApi);
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  uploadFile,
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runCopyBatch } from '@/lib/airtable-final/copy';

const ORG = '11111111-1111-4111-8111-111111111111';
const FRESH_URL = 'https://v5.airtableusercontent.com/v3/u/fresh/photo.png';
const OLD_URL = 'https://v5.airtableusercontent.com/v3/u/old/photo.png';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const PDF = Buffer.from('%PDF-1.7 test');
const EXE = Buffer.from('MZ not allowed');

const tenantCol = ATTACHMENT_COLUMNS.find((c) => c.dbTable === 'tenants')!;

/** Fake Airtable API + CDN. `records` maps record id -> fields. */
function mockNetwork(options: {
  records: Record<string, Record<string, unknown>>;
  files?: Record<string, Buffer | number>;
}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('https://api.airtable.com/')) {
      const records = Object.entries(options.records).map(([id, fields]) => ({ id, fields }));
      return new Response(JSON.stringify({ records }), { status: 200 });
    }
    const file = options.files?.[url];
    if (file === undefined) return new Response('nope', { status: 404 });
    if (typeof file === 'number') return new Response('err', { status: file });
    return new Response(new Uint8Array(file), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const att = (id: string, url = FRESH_URL, filename = 'photo.png', type = 'image/png') => ({ id, url, filename, type });

function emptyColumnsExcept(rows: Record<string, unknown[]>) {
  store.listPendingColumnRows.mockImplementation(async (col: { dbTable: string }) => rows[col.dbTable] ?? []);
  store.countPendingColumnRows.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AIRTABLE_PAT', 'test-pat');
  vi.stubEnv('AIRTABLE_BASE_ID', 'appTEST');
  for (const col of ATTACHMENT_COLUMNS) vi.stubEnv(col.airtableTable, `tbl_${col.dbTable}`);
  vi.stubEnv('AIRTABLE_TABLE_PORTAFOLIO', 'tbl_portafolio');
  vi.stubEnv('AIRTABLE_TABLE_PROPIEDADES', 'tbl_propiedades');
  manifestApi.readManifest.mockResolvedValue({ version: 1, updatedAt: '', items: {} });
  store.listSnapshotRows.mockResolvedValue([]);
  store.setColumnValue.mockResolvedValue(true);
  store.findUnitIds.mockResolvedValue(new Map());
  uploadFile.mockResolvedValue({ path: 'x' });
  emptyColumnsExcept({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('field mapping', () => {
  it('maps every column of the migration scope to a bucket and Airtable field', () => {
    const key = (t: string, c: string) => ATTACHMENT_COLUMNS.find((m) => m.dbTable === t && m.dbColumn === c);
    expect(key('responsables', 'photo_url')?.bucket).toBe('tenant-avatars');
    expect(key('tenants', 'photo_url')?.bucket).toBe('tenant-avatars');
    expect(key('payments', 'receipt_url')?.bucket).toBe('receipts');
    expect(key('account_statements', 'pdf_url')).toMatchObject({ bucket: 'contracts', idColumn: 'airtable_id' });
    expect(key('tax_receipts', 'file_url')).toMatchObject({ bucket: 'receipts', idColumn: 'airtable_id' });
    expect(key('trash_compliance', 'foto_url')?.bucket).toBe('task-proofs');
    expect(key('contracts', 'document_url')?.bucket).toBe('contracts');
    for (const m of ATTACHMENT_COLUMNS) {
      expect(m.airtableTable).toMatch(/^AIRTABLE_TABLE_[A-Z_]+$/);
      expect(m.airtableField).not.toBe('');
    }
  });
});

describe('attachment helpers', () => {
  it('accepts only https Airtable hosts', () => {
    expect(isAirtableUrl(OLD_URL)).toBe(true);
    expect(isAirtableUrl('https://dl.airtable.com/.attachments/a/b/c')).toBe(true);
    expect(isAirtableUrl('http://v5.airtableusercontent.com/x')).toBe(false);
    expect(isAirtableUrl('https://evil.example/airtableusercontent.com')).toBe(false);
    expect(isAirtableUrl('org/tenant/uuid.jpg')).toBe(false);
    expect(isAirtableUrl(null)).toBe(false);
  });

  it('detects png, pdf and rejects other bytes', () => {
    expect(sniffCopyMime(PNG)).toBe('image/png');
    expect(sniffCopyMime(PDF)).toBe('application/pdf');
    expect(sniffCopyMime(EXE)).toBeNull();
  });

  it('builds {orgId}/{resourceId}/{uuid}.{ext} paths for images and pdfs', () => {
    expect(buildCopyPath(ORG, 'row-1', 'image/png')).toMatch(new RegExp(`^${ORG}/row-1/[0-9a-f-]{36}\\.png$`));
    expect(buildCopyPath(ORG, 'row-1', 'application/pdf')).toMatch(new RegExp(`^${ORG}/row-1/[0-9a-f-]{36}\\.pdf$`));
  });

  it('builds archive paths with sanitised, collision-free file names', () => {
    const items = extractSnapshotAttachments('residentes', 'recA', {
      fields: {
        'Foto TIU': [
          att('att1', OLD_URL, '../evil/name.png'),
          att('att2', OLD_URL, '../evil/name.png'),
        ],
        Nombre: 'not an attachment',
      },
    });
    expect(items).toHaveLength(2);
    expect(archivePath(items[0])).toBe('airtable-archive/residentes/recA/Foto TIU/__evil_name.png');
    expect(archivePath(items[1])).toBe('airtable-archive/residentes/recA/Foto TIU/att2___evil_name.png');
  });

  it('ignores unknown snapshot tables and non-Airtable URLs', () => {
    expect(extractSnapshotAttachments('rooms', 'recA', { fields: { Fotos: [att('a')] } })).toEqual([]);
    expect(extractSnapshotAttachments('residentes', 'recA', { fields: { Fotos: [att('a', 'https://x.test/a.png')] } })).toEqual([]);
  });
});

describe('runCopyBatch: columns', () => {
  it('copies a column from a FRESH url, uploads to its bucket and stores the path', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    const fetchMock = mockNetwork({
      records: { recT1: { 'Foto DNI': [att('attA')] } },
      files: { [FRESH_URL]: PNG },
    });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 1, skipped: 0, failed: 0, errors: [] });
    const downloaded = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(downloaded).toContain(FRESH_URL);
    expect(downloaded).not.toContain(OLD_URL);

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [bucket, path, body, contentType] = uploadFile.mock.calls[0];
    expect(bucket).toBe('tenant-avatars');
    expect(path).toMatch(new RegExp(`^${ORG}/row-1/[0-9a-f-]{36}\\.png$`));
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(contentType).toBe('image/png');
    expect(store.setColumnValue).toHaveBeenCalledWith(tenantCol, 'row-1', OLD_URL, path);

    const written = manifestApi.writeManifest.mock.calls[0][0];
    expect(written.items['column:tenants.photo_url#row-1']).toMatchObject({ status: 'column', attachmentId: 'attA', path });
  });

  it('skips values that are already storage paths and writes nothing', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: `${ORG}/row-1/abc.png` }] });
    const fetchMock = mockNetwork({ records: {} });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 0, skipped: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(store.setColumnValue).not.toHaveBeenCalled();
  });

  it('dry-run downloads and validates but makes no writes', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    store.countPendingColumnRows.mockResolvedValue(0);
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: PNG } });

    const summary = await runCopyBatch({ mode: 'dry-run', limit: 10 });

    expect(summary.copied).toBe(1);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(store.setColumnValue).not.toHaveBeenCalled();
    expect(store.insertUnitImage).not.toHaveBeenCalled();
    expect(manifestApi.writeManifest).not.toHaveBeenCalled();
  });

  it('counts a failed download, does not upload or write the DB', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    store.countPendingColumnRows.mockImplementation(async (col: { dbTable: string }) => (col.dbTable === 'tenants' ? 1 : 0));
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: 403 } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 0, failed: 1, remaining: 1 });
    expect(summary.errors).toEqual([{ ref: 'tenants.photo_url#row-1', reason: 'download_http_403' }]);
    expect(JSON.stringify(summary)).not.toContain('airtableusercontent');
    expect(uploadFile).not.toHaveBeenCalled();
    expect(store.setColumnValue).not.toHaveBeenCalled();
    expect(manifestApi.writeManifest).not.toHaveBeenCalled();
  });

  it('reports the storage error of a failed upload without the object path', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: PNG } });
    uploadFile.mockRejectedValue(
      new Error(`[storage.uploadFile] bucket=tenant-avatars path=${ORG}/row-1/x.png error=PutObject failed: HTTP 403 AccessDenied`),
    );

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary.errors).toEqual([
      { ref: 'tenants.photo_url#row-1', reason: 'upload_failed: PutObject failed: HTTP 403 AccessDenied' },
    ]);
    expect(store.setColumnValue).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types and reports them', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: EXE } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary.errors).toEqual([{ ref: 'tenants.photo_url#row-1', reason: 'unsupported_type' }]);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('allows PDFs for document columns', async () => {
    const eecc = ATTACHMENT_COLUMNS.find((c) => c.dbTable === 'account_statements')!;
    store.listPendingColumnRows.mockImplementation(async (col: { dbTable: string }) =>
      col.dbTable === 'account_statements' ? [{ id: 'row-9', orgId: ORG, recordId: 'recE1', value: OLD_URL }] : []);
    mockNetwork({ records: { recE1: { PDF: [att('attP', FRESH_URL, 'e.pdf', 'application/pdf')] } }, files: { [FRESH_URL]: PDF } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary.copied).toBe(1);
    expect(uploadFile.mock.calls[0][0]).toBe(eecc.bucket);
    expect(uploadFile.mock.calls[0][1]).toMatch(/\.pdf$/);
  });

  it('does not touch the DB value when the upload fails', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: PNG } });
    uploadFile.mockRejectedValueOnce(new Error('boom'));

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary.errors).toEqual([{ ref: 'tenants.photo_url#row-1', reason: 'upload_failed' }]);
    expect(store.setColumnValue).not.toHaveBeenCalled();
  });
});

describe('runCopyBatch: snapshots', () => {
  const snapshotRow = (table: string, recordId: string, fields: Record<string, unknown>) => ({
    orgId: ORG, table, recordId, data: { id: recordId, fields },
  });

  it('archives attachments under airtable-archive/<table>/<record>/<field>/<filename> and writes the manifest', async () => {
    store.listSnapshotRows.mockResolvedValue([snapshotRow('propiedades', 'recP1', { Planos: [att('attX', OLD_URL, 'plano.pdf', 'application/pdf')] })]);
    mockNetwork({ records: { recP1: { Planos: [att('attX', FRESH_URL, 'plano.pdf', 'application/pdf')] } }, files: { [FRESH_URL]: PDF } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 1, failed: 0, remaining: 0 });
    expect(uploadFile).toHaveBeenCalledWith('contracts', 'airtable-archive/propiedades/recP1/Planos/plano.pdf', expect.any(Buffer), 'application/pdf', true);
    const written = manifestApi.writeManifest.mock.calls[0][0];
    expect(written.items['propiedades/recP1/Planos/attX']).toMatchObject({ status: 'archived' });
  });

  it('does not copy again an attachment already copied by a column (same attachment id)', async () => {
    emptyColumnsExcept({ tenants: [{ id: 'row-1', orgId: ORG, recordId: 'recT1', value: OLD_URL }] });
    store.listSnapshotRows.mockResolvedValue([snapshotRow('residentes', 'recT1', { 'Foto DNI': [att('attA', OLD_URL)] })]);
    mockNetwork({ records: { recT1: { 'Foto DNI': [att('attA')] } }, files: { [FRESH_URL]: PNG } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 1, skipped: 1, failed: 0, remaining: 0 });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0]).toBe('tenant-avatars');
    const written = manifestApi.writeManifest.mock.calls[0][0];
    expect(written.items['residentes/recT1/Foto DNI/attA']).toMatchObject({ status: 'duplicate' });
  });

  it('skips attachments the manifest already knows (idempotent re-run)', async () => {
    manifestApi.readManifest.mockResolvedValue({
      version: 1, updatedAt: '',
      items: { 'propiedades/recP1/Planos/attX': { status: 'archived', attachmentId: 'attX' } },
    });
    store.listSnapshotRows.mockResolvedValue([snapshotRow('propiedades', 'recP1', { Planos: [att('attX')] })]);
    const fetchMock = mockNetwork({ records: {} });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary).toMatchObject({ copied: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns portafolio image attachments of a known unit into unit_images rows', async () => {
    store.listSnapshotRows.mockResolvedValue([snapshotRow('portafolio', 'recU1', { Fotos: [att('attU', OLD_URL, 'cuarto.png')] })]);
    store.findUnitIds.mockResolvedValue(new Map([['recU1', 'unit-1']]));
    mockNetwork({ records: { recU1: { Fotos: [att('attU', FRESH_URL, 'cuarto.png')] } }, files: { [FRESH_URL]: PNG } });

    const summary = await runCopyBatch({ mode: 'apply', limit: 10 });

    expect(summary.copied).toBe(1);
    const [bucket, path] = uploadFile.mock.calls[0];
    expect(bucket).toBe('unit-images');
    expect(path).toMatch(new RegExp(`^${ORG}/unit-1/[0-9a-f-]{36}\\.png$`));
    expect(store.insertUnitImage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, unitId: 'unit-1', storagePath: path, filename: 'cuarto.png', mimeType: 'image/png', sizeBytes: PNG.byteLength,
    }));
  });

  it('dry-run over snapshots writes nothing', async () => {
    store.listSnapshotRows.mockResolvedValue([snapshotRow('portafolio', 'recU1', { Fotos: [att('attU')] })]);
    store.findUnitIds.mockResolvedValue(new Map([['recU1', 'unit-1']]));
    mockNetwork({ records: { recU1: { Fotos: [att('attU')] } }, files: { [FRESH_URL]: PNG } });

    const summary = await runCopyBatch({ mode: 'dry-run', limit: 10 });

    expect(summary).toMatchObject({ copied: 1, remaining: 1 });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(store.insertUnitImage).not.toHaveBeenCalled();
    expect(manifestApi.writeManifest).not.toHaveBeenCalled();
  });
});
