/**
 * Unit tests for the second pass over the copy's permanent failures
 * (src/lib/airtable-final/recover.ts). fetch, the DB store, the manifest and uploadFile are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ATTACHMENT_COLUMNS } from '@/lib/airtable-final/fields';

const store = vi.hoisted(() => ({
  findColumnRows: vi.fn(),
  setColumnValue: vi.fn(),
  listSnapshotRows: vi.fn(),
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

import { matchCurrent, runRecoverBatch, type FailedItem } from '@/lib/airtable-final/recover';

const ORG = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const FRESH_URL = 'https://v5.airtableusercontent.com/v3/u/fresh/file';
const OLD_URL = 'https://v5.airtableusercontent.com/v3/u/old/file';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const ZIP = Buffer.from('PK\u0003\u0004 some archive');

const tenantCol = ATTACHMENT_COLUMNS.find((c) => c.dbTable === 'tenants')!;

/** Fake Airtable API + CDN. `records` maps record id -> fields. Records not listed do not exist. */
function mockNetwork(options: { records: Record<string, Record<string, unknown>>; files?: Record<string, Buffer> }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('https://api.airtable.com/')) {
      const records = Object.entries(options.records).map(([id, fields]) => ({ id, fields }));
      return new Response(JSON.stringify({ records }), { status: 200 });
    }
    const file = options.files?.[url];
    return file ? new Response(new Uint8Array(file), { status: 200 }) : new Response('gone', { status: 410 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const att = (id: string, url = FRESH_URL, filename = 'plano.zip', size = ZIP.byteLength) => ({ id, url, filename, size, type: 'application/zip' });

function withFailures(failed: Record<string, string>, snapshots: Array<{ table: string; recordId: string; fields: Record<string, unknown> }> = []) {
  manifestApi.readManifest.mockResolvedValue({ version: 1, updatedAt: '', items: {}, failed: { ...failed } });
  store.listSnapshotRows.mockResolvedValue(snapshots.map((s) => ({ orgId: ORG, table: s.table, recordId: s.recordId, data: { fields: s.fields } })));
}

const writtenManifest = () => manifestApi.writeManifest.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AIRTABLE_PAT', 'test-pat');
  vi.stubEnv('AIRTABLE_BASE_ID', 'appTEST');
  vi.stubEnv('AIRTABLE_TABLE_PROPIEDADES', 'tbl_propiedades');
  vi.stubEnv('AIRTABLE_TABLE_RESIDENTES', 'tbl_residentes');
  store.findColumnRows.mockResolvedValue([]);
  store.setColumnValue.mockResolvedValue(true);
  uploadFile.mockResolvedValue({ path: 'x' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('matchCurrent', () => {
  const item: FailedItem = {
    key: 'propiedades/rec1/Planos/att1',
    reason: 'attachment_not_found',
    table: 'propiedades',
    field: 'Planos',
    recordId: 'rec1',
    envKey: 'AIRTABLE_TABLE_PROPIEDADES',
    attachmentId: 'att1',
    filename: 'plano.zip',
    size: 10,
    storedUrl: OLD_URL,
  };

  it('prefers the same attachment in the same field', () => {
    expect(matchCurrent(item, { Planos: [att('att1')] })).toMatchObject({ verdict: 'same_id_same_field', url: FRESH_URL });
  });

  it('finds the attachment moved to another field', () => {
    expect(matchCurrent(item, { Archivos: [att('att1')] })?.verdict).toBe('same_id_other_field');
  });

  it('matches a re-upload by name and size, then by name only', () => {
    expect(matchCurrent(item, { Planos: [att('att9', FRESH_URL, 'plano.zip', 10)] })?.verdict).toBe('same_name_size');
    expect(matchCurrent(item, { Planos: [att('att9', FRESH_URL, 'plano.zip', 99)] })?.verdict).toBe('same_name');
  });

  it('returns null when nothing matches or the record is gone', () => {
    expect(matchCurrent(item, { Planos: [att('att9', FRESH_URL, 'otro.zip')] })).toBeNull();
    expect(matchCurrent(item, undefined)).toBeNull();
  });
});

describe('runRecoverBatch', () => {
  it('report diagnoses every failure and writes nothing', async () => {
    withFailures(
      {
        'propiedades/rec1/Planos/att1': 'unsupported_type',
        'propiedades/rec2/Planos/att2': 'record_not_found',
        'propiedades/rec3/Planos/att3': 'attachment_not_found',
      },
      [{ table: 'propiedades', recordId: 'rec3', fields: { Planos: [att('att3', OLD_URL)] } }],
    );
    mockNetwork({ records: { rec1: { Planos: [att('att1')] }, rec3: { Planos: [] } }, files: { [OLD_URL]: ZIP } });

    const summary = await runRecoverBatch({ mode: 'report', limit: 50 });

    expect(summary).toMatchObject({ total: 3, processed: 3, recovered: 0, nextAfter: null, errors: [] });
    const verdicts = Object.fromEntries(summary.groups.map((g) => [g.reason, g.verdict]));
    expect(verdicts).toEqual({ unsupported_type: 'same_id_same_field', record_not_found: 'record_deleted', attachment_not_found: 'stored_url_alive' });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(manifestApi.writeManifest).not.toHaveBeenCalled();
    expect(JSON.stringify(summary)).not.toContain('airtableusercontent');
  });

  it('recover archives any file type and moves it from failed to items', async () => {
    withFailures({ 'propiedades/rec1/Planos/att1': 'unsupported_type' });
    mockNetwork({ records: { rec1: { Planos: [att('att1')] } }, files: { [FRESH_URL]: ZIP } });

    const summary = await runRecoverBatch({ mode: 'recover', limit: 50 });

    expect(summary.recovered).toBe(1);
    expect(uploadFile).toHaveBeenCalledWith('contracts', 'airtable-archive/recovered/propiedades/rec1/Planos/att1_plano.zip', ZIP, 'application/octet-stream', true);
    const manifest = writtenManifest();
    expect(manifest.failed).toEqual({});
    expect(manifest.items['propiedades/rec1/Planos/att1']).toMatchObject({ status: 'recovered', via: 'same_id_same_field', contentType: 'application/octet-stream' });
  });

  it('recover points a column at the new copy when the type fits', async () => {
    const key = `column:tenants.photo_url#${ROW}`;
    withFailures({ [key]: 'attachment_not_found' });
    store.findColumnRows.mockResolvedValue([{ id: ROW, orgId: ORG, recordId: 'recT', value: OLD_URL }]);
    mockNetwork({ records: { recT: { [tenantCol.airtableField]: [att('attNew', FRESH_URL, 'dni.png', PNG.byteLength)] } }, files: { [FRESH_URL]: PNG } });

    const summary = await runRecoverBatch({ mode: 'recover', limit: 50 });

    expect(summary.recovered).toBe(1);
    expect(store.setColumnValue).toHaveBeenCalledWith(tenantCol, ROW, OLD_URL, expect.stringMatching(new RegExp(`^${ORG}/${ROW}/.+\\.png$`)));
    expect(uploadFile.mock.calls[0][0]).toBe('tenant-avatars');
    const manifest = writtenManifest();
    expect(manifest.failed).toEqual({});
    expect(manifest.items[key]).toMatchObject({ status: 'recovered', bucket: 'tenant-avatars', contentType: 'image/png' });
  });

  it('keeps a column listed as failed when its file type does not fit the column', async () => {
    const key = `column:tenants.photo_url#${ROW}`;
    withFailures({ [key]: 'unsupported_type' });
    store.findColumnRows.mockResolvedValue([{ id: ROW, orgId: ORG, recordId: 'recT', value: OLD_URL }]);
    mockNetwork({ records: { recT: { [tenantCol.airtableField]: [att('attZ')] } }, files: { [FRESH_URL]: ZIP } });

    await runRecoverBatch({ mode: 'recover', limit: 50 });

    expect(store.setColumnValue).not.toHaveBeenCalled();
    const manifest = writtenManifest();
    expect(manifest.failed).toEqual({ [key]: 'unsupported_type' });
    expect(manifest.items[`recovered:${key}`]).toMatchObject({ status: 'recovered', bucket: 'contracts' });
  });

  it('pages with the after cursor in key order', async () => {
    withFailures({
      'propiedades/rec2/Planos/att2': 'record_not_found',
      'propiedades/rec1/Planos/att1': 'record_not_found',
      'propiedades/rec3/Planos/att3': 'record_not_found',
    });
    mockNetwork({ records: {} });

    const first = await runRecoverBatch({ mode: 'report', limit: 2 });
    expect(first).toMatchObject({ processed: 2, nextAfter: 'propiedades/rec2/Planos/att2' });
    const second = await runRecoverBatch({ mode: 'report', limit: 2, after: first.nextAfter });
    expect(second).toMatchObject({ processed: 1, nextAfter: null });
  });

  it('pages through keys whose locale order differs from code-unit order without overlap or gaps', async () => {
    withFailures({
      'propiedades/reca/Planos/att1': 'record_not_found',
      'propiedades/recB/Planos/att2': 'record_not_found',
      'propiedades/recB/Planos y otros/att3': 'record_not_found',
      'propiedades/recB/Planos/att4': 'record_not_found',
    });
    mockNetwork({ records: {} });

    let after: string | null = null;
    let processed = 0;
    do {
      const page = await runRecoverBatch({ mode: 'report', limit: 1, after });
      processed += page.processed;
      after = page.nextAfter;
    } while (after);
    expect(processed).toBe(4);
  });

  it('only reads from Airtable', async () => {
    withFailures({ 'propiedades/rec1/Planos/att1': 'unsupported_type' });
    const fetchMock = mockNetwork({ records: { rec1: { Planos: [att('att1')] } }, files: { [FRESH_URL]: ZIP } });

    await runRecoverBatch({ mode: 'recover', limit: 50 });

    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
  });
});
