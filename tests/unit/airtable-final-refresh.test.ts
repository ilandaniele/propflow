/**
 * Unit tests for the snapshot refresh (src/lib/airtable-final/refresh.ts).
 * fetch, the DB store and uploadFile are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => ({
  countPendingColumnRows: vi.fn(),
  listSnapshotTable: vi.fn(),
  updateSnapshotRows: vi.fn(),
  insertSnapshotRows: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/airtable-final/store', () => store);
vi.mock('@/lib/airtable-final/manifest', () => ({ readManifest: vi.fn() }));
vi.mock('@/lib/storage', () => ({ uploadFile }));

import { planRefresh, runRefreshTable } from '@/lib/airtable-final/refresh';

const ORG = '11111111-1111-4111-8111-111111111111';
const att = (id: string, url = `https://v5.airtableusercontent.com/${id}`) => ({ id, url, filename: `${id}.pdf` });

const snapshots = [
  { orgId: ORG, recordId: 'recSame', data: { id: 'recSame', createdTime: 't0', fields: { Monto: 1, PDF: [att('a1', 'https://old/url')] } } },
  { orgId: ORG, recordId: 'recEdited', data: { id: 'recEdited', createdTime: 't1', fields: { Monto: 2, PDF: [att('a2')] } } },
  { orgId: ORG, recordId: 'recGone', data: { id: 'recGone', fields: { Monto: 3 } } },
];
const records = [
  { id: 'recSame', fields: { Monto: 1, PDF: [att('a1', 'https://fresh/url')] } },
  { id: 'recEdited', fields: { Monto: 20, PDF: [att('a2'), att('a3')] } },
  { id: 'recNew', fields: { Monto: 4 } },
];

function mockAirtable(list: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ records: list }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AIRTABLE_PAT', 'test-pat');
  vi.stubEnv('AIRTABLE_BASE_ID', 'appTEST');
  vi.stubEnv('AIRTABLE_TABLE_ADICIONALES', 'tbl_adicionales');
  store.listSnapshotTable.mockResolvedValue(snapshots);
  uploadFile.mockResolvedValue({ path: 'x' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('planRefresh', () => {
  it('updates changed records keeping other data keys, adds new ones and leaves deleted ones alone', () => {
    const plan = planRefresh(records, snapshots);

    expect(plan.unchanged).toBe(1);
    expect(plan.previous).toEqual([snapshots[1]]);
    expect(plan.updates).toEqual([{ orgId: ORG, recordId: 'recEdited', data: { id: 'recEdited', createdTime: 't1', fields: records[1].fields } }]);
    expect(plan.inserts).toEqual([{ orgId: ORG, recordId: 'recNew', data: { id: 'recNew', fields: { Monto: 4 } } }]);
    expect(plan.skippedNoOrg).toBe(0);
  });

  it('skips new records when the table has no single org', () => {
    const plan = planRefresh([{ id: 'recNew', fields: {} }], []);
    expect(plan).toMatchObject({ inserts: [], skippedNoOrg: 1 });
  });
});

describe('runRefreshTable', () => {
  it('archives the previous data before writing, and only reads Airtable', async () => {
    const fetchMock = mockAirtable(records);
    const order: string[] = [];
    uploadFile.mockImplementation(async () => order.push('archive'));
    store.updateSnapshotRows.mockImplementation(async () => order.push('update'));

    const result = await runRefreshTable({ after: null });

    expect(result).toEqual({ table: { table: 'adicionales', updated: 1, inserted: 1, unchanged: 1, skippedNoOrg: 0 }, nextAfter: 'adicionales' });
    expect(order).toEqual(['archive', 'update']);
    const [bucket, path, body] = uploadFile.mock.calls[0];
    expect(bucket).toBe('contracts');
    expect(path).toMatch(/^airtable-archive\/snapshots-before-refresh\/adicionales\/.+\.json$/);
    expect(JSON.parse(body.toString())).toEqual([snapshots[1]]);
    expect(store.insertSnapshotRows).toHaveBeenCalledWith('adicionales', [expect.objectContaining({ recordId: 'recNew' })]);
    for (const call of fetchMock.mock.calls as unknown[][]) expect((call[1] as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
  });

  it('writes nothing when nothing changed', async () => {
    mockAirtable([records[0]]);
    store.listSnapshotTable.mockResolvedValue([snapshots[0]]);

    await runRefreshTable({ after: null });

    expect(uploadFile).not.toHaveBeenCalled();
    expect(store.updateSnapshotRows).toHaveBeenCalledWith('adicionales', []);
  });

  it('reports a table it cannot read and writes nothing', async () => {
    const result = await runRefreshTable({ after: 'adicionales' });
    expect(result).toMatchObject({ table: null, error: { table: 'ausencias', reason: 'table_not_configured' } });
    expect(store.updateSnapshotRows).not.toHaveBeenCalled();
  });
});
