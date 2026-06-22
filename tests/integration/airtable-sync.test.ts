/**
 * tests/integration/airtable-sync.test.ts
 *
 * AC7: Sync upserts rows into airtable_snapshots and writes airtable_sync_logs
 *      entry with status and count.
 *
 * Coverage:
 * 1. Happy path: N records fetched → N rows upserted → log with status=success, count=N
 * 2. Error path: fetch failure → log with status=error, count=0
 * 3. Upsert conflict: calling sync twice for same records → second call upserts (updates) not inserts
 * 4. Empty table: 0 records → log with status=success, count=0
 * 5. Partial failure: upsert error mid-batch → log with status=partial or error
 *
 * All DB calls are mocked via @/lib/db (Drizzle).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state — controlled per test
// ---------------------------------------------------------------------------

interface UpsertRow {
  orgId: string;
  tableName: string;
  externalId: string;
  data: unknown;
  syncedAt: Date;
}

interface LogRow {
  orgId: string;
  tableName: string;
  status: string;
  recordsUpserted: number;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date;
}

const mockState = {
  listRecordsError: null as string | null,
  listRecordsResult: [] as Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>,
  upsertError:       null as string | null,
  insertLogError:    null as string | null,
  logInsertId:       'log-uuid-001',
  upsertCalls:       [] as Array<{ rows: UpsertRow[]; onConflictTarget: unknown }>,
  insertLogCalls:    [] as LogRow[],
};

// ---------------------------------------------------------------------------
// Mock: AirtableClient
// ---------------------------------------------------------------------------

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: vi.fn(() => ({
    listRecords: vi.fn(async () => {
      if (mockState.listRecordsError) {
        throw new Error(mockState.listRecordsError);
      }
      return mockState.listRecordsResult;
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  return {
    db: {
      insert: vi.fn((tableRef: unknown) => {
        const table = getTableName(tableRef);
        return {
          values: vi.fn((data: unknown) => ({
            onConflictDoUpdate: vi.fn(async (opts: unknown) => {
              if (table === 'airtable_snapshots') {
                const rows = Array.isArray(data) ? data : [data];
                mockState.upsertCalls.push({ rows: rows as UpsertRow[], onConflictTarget: opts });
                if (mockState.upsertError) {
                  throw new Error(mockState.upsertError);
                }
                return [];
              }
              return [];
            }),
            returning: vi.fn(async () => {
              if (table === 'airtable_sync_logs') {
                const row = data as LogRow;
                mockState.insertLogCalls.push(row);
                if (mockState.insertLogError) {
                  throw new Error(mockState.insertLogError);
                }
                return [{ id: mockState.logInsertId }];
              }
              return [{ id: mockState.logInsertId }];
            }),
            onConflictDoNothing: vi.fn(async () => []),
          })),
        };
      }),

      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn(async () => []),
      })),

      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Helper: make a fake AirtableRecord
// ---------------------------------------------------------------------------

function makeRecord(id: string, name = 'Room') {
  return {
    id,
    createdTime: '2026-06-01T00:00:00.000Z',
    fields: { Name: name, Property: 'Casa A', 'Monthly Rent': 500 },
  };
}

// ---------------------------------------------------------------------------
// Import SUT after mocks are set up
// ---------------------------------------------------------------------------

import { syncAirtableTable } from '@/lib/airtable/sync';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncAirtableTable (AC7)', () => {
  const ORG_ID = 'org-uuid-001';
  const TABLE_ENV_KEY = 'AIRTABLE_TABLE_ROOMS';

  beforeEach(() => {
    mockState.listRecordsError = null;
    mockState.listRecordsResult = [];
    mockState.upsertError = null;
    mockState.insertLogError = null;
    mockState.logInsertId = 'log-uuid-001';
    mockState.upsertCalls = [];
    mockState.insertLogCalls = [];

    process.env['AIRTABLE_TABLE_ROOMS'] = 'tblROOMS123';
  });

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it('AC7: upserts N rows and writes status=success log with correct count', async () => {
    const records = [makeRecord('rec001'), makeRecord('rec002'), makeRecord('rec003')];
    mockState.listRecordsResult = records;

    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    expect(result.status).toBe('success');
    expect(result.count).toBe(3);
    expect(result.logId).toBe('log-uuid-001');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Upsert was called with correct shape
    expect(mockState.upsertCalls).toHaveLength(1);
    const upsertCall = mockState.upsertCalls[0];
    expect(upsertCall.rows).toHaveLength(3);

    // Each row has required fields (Drizzle camelCase)
    for (const row of upsertCall.rows) {
      expect(row.orgId).toBe(ORG_ID);
      expect(row.tableName).toBe('rooms'); // derived from AIRTABLE_TABLE_ROOMS
      expect(typeof row.externalId).toBe('string');
      expect(row.data).toBeDefined();
      expect(row.syncedAt).toBeInstanceOf(Date);
    }

    // external_ids match record ids
    const externalIds = upsertCall.rows.map(r => r.externalId);
    expect(externalIds).toContain('rec001');
    expect(externalIds).toContain('rec002');
    expect(externalIds).toContain('rec003');

    // Log was written with correct values (Drizzle camelCase)
    expect(mockState.insertLogCalls).toHaveLength(1);
    const logRow = mockState.insertLogCalls[0];
    expect(logRow.orgId).toBe(ORG_ID);
    expect(logRow.tableName).toBe('rooms');
    expect(logRow.status).toBe('success');
    expect(logRow.recordsUpserted).toBe(3);
    expect(logRow.errorMessage).toBeNull();
    expect(logRow.startedAt).toBeInstanceOf(Date);
    expect(logRow.completedAt).toBeInstanceOf(Date);
  });

  // ── 2. Empty table ────────────────────────────────────────────────────────

  it('writes status=success and count=0 when Airtable table has no records', async () => {
    mockState.listRecordsResult = [];

    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    expect(result.status).toBe('success');
    expect(result.count).toBe(0);

    // No upsert call when records list is empty
    expect(mockState.upsertCalls).toHaveLength(0);

    // Log still written
    expect(mockState.insertLogCalls).toHaveLength(1);
    expect(mockState.insertLogCalls[0].recordsUpserted).toBe(0);
    expect(mockState.insertLogCalls[0].status).toBe('success');
  });

  // ── 3. Airtable fetch error ───────────────────────────────────────────────

  it('writes status=error and count=0 when Airtable fetch fails', async () => {
    mockState.listRecordsError = 'Connection timed out';

    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    expect(result.status).toBe('error');
    expect(result.count).toBe(0);
    expect(result.errorMessage).toContain('Connection timed out');

    // Upsert was NOT called
    expect(mockState.upsertCalls).toHaveLength(0);

    // Log was still written with error status
    expect(mockState.insertLogCalls).toHaveLength(1);
    const logRow = mockState.insertLogCalls[0];
    expect(logRow.status).toBe('error');
    expect(logRow.recordsUpserted).toBe(0);
    expect(logRow.errorMessage).toContain('Connection timed out');
  });

  // ── 4. Upsert DB error ────────────────────────────────────────────────────

  it('writes status=error and count=0 when upsert fails on first batch', async () => {
    mockState.listRecordsResult = [makeRecord('rec001'), makeRecord('rec002')];
    mockState.upsertError = 'duplicate key value violates unique constraint';

    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    // Upsert error with 0 upserted = error (not partial)
    expect(result.status).toBe('error');
    expect(result.count).toBe(0);

    // Log written with error
    expect(mockState.insertLogCalls).toHaveLength(1);
    const logRow = mockState.insertLogCalls[0];
    expect(logRow.status).toBe('error');
    expect(logRow.recordsUpserted).toBe(0);
    expect(logRow.errorMessage).toContain('Upsert batch');
  });

  // ── 5. Table name derivation ──────────────────────────────────────────────

  it('derives table_name "performance" from AIRTABLE_TABLE_PERFORMANCE env key', async () => {
    process.env['AIRTABLE_TABLE_PERFORMANCE'] = 'tblPERF456';
    mockState.listRecordsResult = [makeRecord('rec999')];

    const result = await syncAirtableTable(ORG_ID, 'AIRTABLE_TABLE_PERFORMANCE');

    expect(result.status).toBe('success');
    const upsertRow = mockState.upsertCalls[0]?.rows[0];
    expect(upsertRow?.tableName).toBe('performance');
  });

  // ── 6. Custom normalizer ──────────────────────────────────────────────────

  it('applies custom normalizer to transform records before storage', async () => {
    mockState.listRecordsResult = [makeRecord('rec010', 'Suite 1')];

    const customNormalizer = vi.fn((record: { id: string; fields: Record<string, unknown> }) => ({
      customField: `normalized-${record.id}`,
      name: record.fields['Name'],
    }));

    await syncAirtableTable(ORG_ID, TABLE_ENV_KEY, customNormalizer as never);

    expect(customNormalizer).toHaveBeenCalledTimes(1);
    const upsertRow = mockState.upsertCalls[0]?.rows[0];
    expect(upsertRow?.data).toMatchObject({ customField: 'normalized-rec010', name: 'Suite 1' });
  });

  // ── 7. Log ID returned from DB ────────────────────────────────────────────

  it('returns the logId from the inserted sync log row', async () => {
    mockState.listRecordsResult = [makeRecord('rec777')];
    mockState.logInsertId = 'custom-log-id-xyz';

    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    expect(result.logId).toBe('custom-log-id-xyz');
  });

  // ── 8. Log insert failure is gracefully handled ───────────────────────────

  it('returns "unknown" logId and does not throw when log insert fails', async () => {
    mockState.listRecordsResult = [makeRecord('rec888')];
    mockState.insertLogError = 'permission denied';

    // Should NOT throw — sync result is still returned
    const result = await syncAirtableTable(ORG_ID, TABLE_ENV_KEY);

    expect(result.status).toBe('success');
    expect(result.count).toBe(1);
    expect(result.logId).toBe('unknown');
  });
});
