/**
 * tests/integration/csv-import.test.ts
 *
 * Integration tests for src/app/actions/imports.ts
 *
 * AC17: uploadCsvDryRun → csv_imports row with status=dry_run; no import_rows.
 * AC18: commitCsvImport → import_rows written + status=committed + committed_at.
 * AC21: uploadCsvDryRun rejects files > 5 MB with FILE_TOO_LARGE.
 *
 * All external dependencies (Supabase, guards) are mocked — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_CSV_BYTES } from '@/lib/schemas/imports';

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface DbCallRecord {
  table: string;
  operation: string;
  data: unknown;
}

interface MockState {
  requireAdminError: string | null;
  userId: string;
  orgId: string;
  insertedImport: { id: string } | null;
  insertedImportError: { code: string } | null;
  fetchImportResult: {
    id: string;
    org_id: string;
    status: string;
    import_type: string;
  } | null;
  fetchImportError: { code: string } | null;
  insertRowsError: { code: string } | null;
  updateImportError: { code: string } | null;
  dbCalls: DbCallRecord[];
}

// Use valid UUIDs throughout
const IMPORT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID   = '00000000-0000-0000-0000-000000000002';
const ORG_ID    = '00000000-0000-0000-0000-000000000003';

const mockState: MockState = {
  requireAdminError: null,
  userId: USER_ID,
  orgId:  ORG_ID,
  insertedImport: { id: IMPORT_ID },
  insertedImportError: null,
  fetchImportResult: {
    id:          IMPORT_ID,
    org_id:      ORG_ID,
    status:      'dry_run',
    import_type: 'monthly_billed',
  },
  fetchImportError: null,
  insertRowsError: null,
  updateImportError: null,
  dbCalls: [],
};

// ---------------------------------------------------------------------------
// Mock: requireAdmin
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (mockState.requireAdminError) throw new Error(mockState.requireAdminError);
    return { userId: mockState.userId, orgId: mockState.orgId, role: 'admin', profile: {} };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: mutationRateLimit — always allow
// ---------------------------------------------------------------------------

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn(() => ({ success: true })),
}));

// ---------------------------------------------------------------------------
// Mock: createClient (Supabase)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      return {
        insert: vi.fn((data: unknown) => {
          mockState.dbCalls.push({ table})),
  createAdminServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      return {
        insert: vi.fn((data: unknown) => {
          mockState.dbCalls.push({ table, operation: 'insert', data });

          if (table === 'csv_imports') {
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (mockState.insertedImportError) {
                    return { data: null, error: mockState.insertedImportError };
                  }
                  return { data: mockState.insertedImport, error: null };
                }),
              })),
            };
          }

          if (table === 'import_rows') {
            return Promise.resolve({
              error: mockState.insertRowsError,
            });
          }

          return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) };
        }),

        select: vi.fn(() => ({
          eq: vi.fn((_col: string, _val: unknown) => ({
            single: vi.fn(async () => {
              if (table === 'csv_imports') {
                if (mockState.fetchImportError) {
                  return { data: null, error: mockState.fetchImportError };
                }
                return { data: mockState.fetchImportResult, error: null };
              }
              return { data: null, error: null };
            }),
          })),
          order: vi.fn(() => ({
            range: vi.fn(() => ({
              then: vi.fn(),
            })),
          })),
        })),

        update: vi.fn((_data: unknown) => ({
          eq: vi.fn((_col: string, _val: unknown) => {
            mockState.dbCalls.push({ table, operation: 'update', data: _data });
            return Promise.resolve({ error: mockState.updateImportError });
          }),
        })),

        upsert: vi.fn((data: unknown) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'mapping-uuid-001', ...data }, error: null })),
          })),
        })),
      };
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCsvBase64(headers: string[], rows: string[][]): string {
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  return Buffer.from(csv, 'utf-8').toString('base64');
}

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

const VALID_BILLED_CSV_B64 = buildCsvBase64(
  ['room_label', 'property_name', 'period', 'billed_amount'],
  [
    ['Room A', 'Casa Verde', '2024-01', '1200'],
    ['Room B', 'Casa Verde', '2024-01', '900'],
    ['Room C', 'Casa Azul',  '2024-01', '800'],
  ]
);

// ---------------------------------------------------------------------------
// Import SUT after all mocks registered
// ---------------------------------------------------------------------------

import { uploadCsvDryRun, commitCsvImport } from '@/app/actions/imports';

// ---------------------------------------------------------------------------
// Tests: uploadCsvDryRun (AC17, AC21)
// ---------------------------------------------------------------------------

describe('uploadCsvDryRun (AC17, AC21)', () => {
  beforeEach(() => {
    // Reset state
    mockState.requireAdminError  = null;
    mockState.insertedImport     = { id: IMPORT_ID };
    mockState.insertedImportError = null;
    mockState.dbCalls            = [];
  });

  // ── AC17: dry-run inserts csv_imports with status=dry_run ─────────────────

  it('AC17: returns a dryRun result with csvImportId on success', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.csvImportId).toBe(IMPORT_ID);
    expect(result.data?.importType).toBe('monthly_billed');
    expect(result.data?.period).toBe('2024-01');
  });

  it('AC17: inserts a csv_imports row with status=dry_run', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    await uploadCsvDryRun({}, fd);

    const importInsert = mockState.dbCalls.find(c => c.table === 'csv_imports' && c.operation === 'insert');
    expect(importInsert).toBeDefined();
    expect((importInsert!.data as { status: string }).status).toBe('dry_run');
  });

  it('AC17: does NOT insert any import_rows during dry-run', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    await uploadCsvDryRun({}, fd);

    const rowInserts = mockState.dbCalls.filter(c => c.table === 'import_rows');
    expect(rowInserts).toHaveLength(0);
  });

  it('AC17: totalRows reflects the number of CSV data rows', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);

    expect(result.data?.totalRows).toBe(3);
  });

  it('AC17: validRows matches the number of valid rows', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);

    expect(result.data?.validRows).toBe(3);
    expect(result.data?.invalidRows).toBe(0);
  });

  // ── AC21: file size cap ────────────────────────────────────────────────────

  it('AC21: rejects oversized file with FILE_TOO_LARGE error code', async () => {
    const oversizedBuffer = Buffer.alloc(MAX_CSV_BYTES + 1, 'x');
    const oversizedB64 = oversizedBuffer.toString('base64');

    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'big.csv',
      fileBase64: oversizedB64,
    });

    const result = await uploadCsvDryRun({}, fd);

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe('FILE_TOO_LARGE');
  });

  it('AC21: does not insert anything to DB when file is too large', async () => {
    const oversizedB64 = Buffer.alloc(MAX_CSV_BYTES + 1, 'x').toString('base64');
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'big.csv',
      fileBase64: oversizedB64,
    });

    await uploadCsvDryRun({}, fd);

    expect(mockState.dbCalls.filter(c => c.table === 'csv_imports')).toHaveLength(0);
    expect(mockState.dbCalls.filter(c => c.table === 'import_rows')).toHaveLength(0);
  });

  // ── Auth checks ────────────────────────────────────────────────────────────

  it('returns UNAUTHORIZED when requireAdmin throws', async () => {
    mockState.requireAdminError = 'UNAUTHORIZED';
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  // ── Validation error ───────────────────────────────────────────────────────

  it('returns VALIDATION_ERROR when importType is missing', async () => {
    const fd = makeFormData({
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when period format is invalid', async () => {
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '01-2024',  // wrong format
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  // ── DB error ───────────────────────────────────────────────────────────────

  it('returns INTERNAL_ERROR when DB insert fails', async () => {
    mockState.insertedImportError = { code: '23505' };
    const fd = makeFormData({
      importType: 'monthly_billed',
      period:     '2024-01',
      filename:   'billed.csv',
      fileBase64: VALID_BILLED_CSV_B64,
    });

    const result = await uploadCsvDryRun({}, fd);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Tests: commitCsvImport (AC18)
// ---------------------------------------------------------------------------

describe('commitCsvImport (AC18)', () => {
  beforeEach(() => {
    mockState.requireAdminError  = null;
    mockState.fetchImportResult  = {
      id:          IMPORT_ID,
      org_id:      ORG_ID,
      status:      'dry_run',
      import_type: 'monthly_billed',
    };
    mockState.fetchImportError   = null;
    mockState.insertRowsError    = null;
    mockState.updateImportError  = null;
    mockState.dbCalls            = [];
  });

  it('AC18: returns rowsWritten and committedAt on success', async () => {
    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.csvImportId).toBe(IMPORT_ID);
    expect(result.data?.rowsWritten).toBe(3);
    expect(typeof result.data?.committedAt).toBe('string');
  });

  it('AC18: updates csv_imports.status to committed', async () => {
    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    await commitCsvImport({}, fd);

    const updateCall = mockState.dbCalls.find(c => c.table === 'csv_imports' && c.operation === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall!.data as { status: string }).status).toBe('committed');
    expect((updateCall!.data as { committed_at: string }).committed_at).toBeDefined();
  });

  it('AC18: inserts import_rows for each data row', async () => {
    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    await commitCsvImport({}, fd);

    const rowInserts = mockState.dbCalls.filter(c => c.table === 'import_rows');
    expect(rowInserts.length).toBeGreaterThan(0);
    // The batch insert contains all 3 rows
    const totalRows = rowInserts.reduce((acc, c) => {
      return acc + (Array.isArray(c.data) ? c.data.length : 0);
    }, 0);
    expect(totalRows).toBe(3);
  });

  it('returns IMPORT_ALREADY_COMMITTED when status is not dry_run', async () => {
    mockState.fetchImportResult = {
      id:          IMPORT_ID,
      org_id:      ORG_ID,
      status:      'committed',  // already committed
      import_type: 'monthly_billed',
    };

    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);
    expect(result.error?.code).toBe('IMPORT_ALREADY_COMMITTED');
  });

  it('returns IMPORT_NOT_FOUND when import record does not exist', async () => {
    mockState.fetchImportError  = { code: 'PGRST116' };
    mockState.fetchImportResult = null;

    // Use a different valid UUID so Zod passes, but the DB mock returns error
    const notFoundId = '99999999-9999-9999-9999-999999999999';
    const fd = makeFormData({
      importId:   notFoundId,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);
    expect(result.error?.code).toBe('IMPORT_NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    mockState.requireAdminError = 'UNAUTHORIZED';

    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns INTERNAL_ERROR when import_rows insert fails', async () => {
    mockState.insertRowsError = { code: '23503' };

    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: VALID_BILLED_CSV_B64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('AC21: rejects oversized file even in commit path', async () => {
    const oversizedB64 = Buffer.alloc(MAX_CSV_BYTES + 1, 'x').toString('base64');
    const fd = makeFormData({
      importId:   IMPORT_ID,
      fileBase64: oversizedB64,
      importType: 'monthly_billed',
      period:     '2024-01',
    });

    const result = await commitCsvImport({}, fd);
    expect(result.error?.code).toBe('FILE_TOO_LARGE');
  });
});
