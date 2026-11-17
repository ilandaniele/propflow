/**
 * Unit tests for the read-only check of our Airtable copy (src/lib/airtable-final/verify.ts).
 * fetch, the DB store and the manifest are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Manifest } from '@/lib/airtable-final/manifest';

const store = vi.hoisted(() => ({ countPendingColumnRows: vi.fn(), listSnapshotTable: vi.fn() }));
const manifestApi = vi.hoisted(() => ({ readManifest: vi.fn() }));

vi.mock('@/lib/airtable-final/store', () => store);
vi.mock('@/lib/airtable-final/manifest', () => manifestApi);

import { compareTable, runVerifyTable } from '@/lib/airtable-final/verify';

const att = (id: string, url = `https://v5.airtableusercontent.com/${id}`) => ({ id, url, filename: `${id}.pdf` });

const manifest: Manifest = {
  version: 1,
  updatedAt: '',
  items: { 'eecc/rec1/PDF/attCopied': { status: 'archived', attachmentId: 'attCopied' } },
  failed: { 'eecc/rec2/PDF/attLost': 'attachment_not_found' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AIRTABLE_PAT', 'test-pat');
  vi.stubEnv('AIRTABLE_BASE_ID', 'appTEST');
  vi.stubEnv('AIRTABLE_TABLE_ADICIONALES', 'tbl_adicionales');
  store.countPendingColumnRows.mockResolvedValue(0);
  store.listSnapshotTable.mockResolvedValue([]);
  manifestApi.readManifest.mockResolvedValue(manifest);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('compareTable', () => {
  it('counts missing, deleted and changed records and classifies every attachment', () => {
    const records = [
      { id: 'rec1', fields: { Monto: 100, PDF: [att('attCopied', 'https://fresh/url')] } },
      { id: 'rec2', fields: { Monto: 250, PDF: [att('attLost'), att('attNew')] } },
      { id: 'recNew', fields: { Monto: 5 } },
    ];
    const snapshots = [
      { recordId: 'rec1', data: { fields: { Monto: 100, PDF: [att('attCopied', 'https://old/url')] } } },
      { recordId: 'rec2', data: { fields: { Monto: 200, PDF: [att('attLost')] } } },
      { recordId: 'recGone', data: { fields: { Monto: 1 } } },
    ];

    expect(compareTable('eecc', records, snapshots, manifest)).toEqual({
      table: 'eecc',
      airtableRecords: 3,
      snapshotRecords: 3,
      missingRecords: 1,
      deletedInAirtable: 1,
      changedFields: { Monto: 1, PDF: 1 },
      attachments: 3,
      attachmentsCopied: 1,
      attachmentsLost: 1,
      attachmentsMissing: 1,
    });
  });

  it('ignores key order inside object values', () => {
    const records = [{ id: 'rec1', fields: { Info: { a: 1, b: 2 } } }];
    const snapshots = [{ recordId: 'rec1', data: { fields: { Info: { b: 2, a: 1 } } } }];
    expect(compareTable('eecc', records, snapshots, manifest).changedFields).toEqual({});
  });
});

describe('runVerifyTable', () => {
  it('reads every page of the first table with GET only and points at the next table', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = url.searchParams.get('offset')
        ? { records: [{ id: 'rec2', fields: {} }] }
        : { records: [{ id: 'rec1', fields: {} }], offset: 'next' };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runVerifyTable({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
    expect(result.table).toMatchObject({ table: 'adicionales', airtableRecords: 2, missingRecords: 2 });
    expect(result.nextAfter).toBe('adicionales');
    expect(store.listSnapshotTable).toHaveBeenCalledWith('adicionales');
  });

  it('reports an unconfigured table and moves on', async () => {
    const result = await runVerifyTable({ after: 'adicionales' });
    expect(result).toMatchObject({ table: null, error: { table: 'ausencias', reason: 'table_not_configured' }, nextAfter: 'ausencias' });
  });

  it('returns no next cursor after the last table', async () => {
    vi.stubEnv('AIRTABLE_TABLE_TURNOS_BASURA', 'tbl_turnos');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [] }), { status: 200 })));
    const result = await runVerifyTable({ after: 'responsables' });
    expect(result).toMatchObject({ table: { table: 'turnos_basura' }, nextAfter: null });
  });
});
