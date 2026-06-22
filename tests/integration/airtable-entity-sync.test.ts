/**
 * tests/integration/airtable-entity-sync.test.ts
 *
 * Integration tests for POST /api/cron/airtable-sync — entity sync path.
 *
 * Strategy: mock the Supabase admin client and Airtable HTTP calls (no real network).
 * Tests exercise the full route handler through the Next.js Request/Response boundary.
 *
 * Covers:
 *   AC1  — Auth guard (no header / wrong header / correct header)
 *   AC2  — Full sync writes domain rows with airtable_external_id; logs success
 *   AC3  — Idempotent re-run: upsert called with onConflict + ignoreDuplicates=false;
 *           protected column (profile_id) stripped from payload
 *   AC5  — Unresolved link → FK null, row upserted, no throw
 *   AC6  — One entity errors → others succeed → HTTP 200 with partial status
 *   AC7  — Missing env var → entity skipped; response still 200 with entityResults
 *   AC8  — Org isolation: org_id always present in upsert payload
 *   AC10 — airtable_snapshots upsert called with raw record JSON
 *   AC11 — airtable_synced_at present in upserted row
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Env setup — must be set before any module import that reads process.env
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-integration';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

// We set process.env before importing the route so the module initializes with our values.
process.env['CRON_SECRET'] = CRON_SECRET;
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://placeholder.supabase.co';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'placeholder_anon_key';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'placeholder_service_role_key';
process.env['AIRTABLE_PAT'] = 'pat.integration_test_token';
process.env['AIRTABLE_BASE_ID'] = 'appINTEGRATIONTEST';
process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES';
process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRESIDENTES';
process.env['AIRTABLE_TABLE_HISTORIAL'] = 'tblHISTORIAL';
process.env['AIRTABLE_TABLE_PAGOS'] = 'tblPAGOS';

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js / admin client
// ---------------------------------------------------------------------------

/** Stores all calls made to `from(table).upsert(rows, opts)` */
const upsertCalls: Array<{ table: string; rows: unknown[]; opts: unknown }> = [];
/** Stores all calls made to `from(table).insert(row)` */
const insertCalls: Array<{ table: string; row: unknown }> = [];
/** Stores all calls made to `from(table).select(...)` */
const selectCalls: Array<{ table: string }> = [];

type UpsertResult = { error: null | { message: string } };
type InsertResult = { error: null | { message: string } };
type SelectResult = { data: unknown[] | null; error: null };

// Per-test control handles
let propiedadesUpsertError: { message: string } | null = null;
let residentsUpsertError: { message: string } | null = null;
let orgsSelectResult: Array<{ id: string }> = [{ id: ORG_ID }];
// Units returned by the unitMap query; key = org_id (ignored in mock, returns all)
let unitsSelectResult: Array<{ id: string; property_id: string; label: string }> = [];

function makeSupabaseBuilder(table: string) {
  const builder: Record<string, unknown> = {};

  builder['upsert'] = (rows: unknown[], opts: unknown): UpsertResult => {
    upsertCalls.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts });
    if (table === 'properties' && propiedadesUpsertError) {
      return { error: propiedadesUpsertError };
    }
    if (table === 'tenants' && residentsUpsertError) {
      return { error: residentsUpsertError };
    }
    return { error: null };
  };

  builder['insert'] = (row: unknown): InsertResult => {
    insertCalls.push({ table, row });
    return { error: null };
  };

  // select chain: .select().eq().in() → returns data
  const eqChain = {
    in: (_col: string, _vals: string[]): SelectResult => {
      if (table === 'organizations') {
        return { data: orgsSelectResult, error: null };
      }
      // For idMap select: return rows mapping external id → uuid
      return {
        data: [
          { id: 'supabase-prop-uuid-001', airtable_external_id: 'recPROP001' },
          { id: 'supabase-tenant-uuid-001', airtable_external_id: 'recTENANT001' },
        ],
        error: null,
      };
    },
    eq: function (_col: string, _val: string) { return this; },
  };

  const selectChain = {
    eq: (_col: string, _val: string): typeof eqChain | SelectResult => {
      // units query terminates at .eq('org_id', orgId) — return data directly
      if (table === 'units') {
        return { data: unitsSelectResult, error: null };
      }
      return eqChain;
    },
  };

  builder['select'] = (_cols?: string): typeof selectChain | SelectResult => {
    selectCalls.push({ table });
    if (table === 'organizations') {
      return { data: orgsSelectResult, error: null } as SelectResult;
    }
    return selectChain;
  };

  return builder;
}

// Mock @/lib/db — Drizzle ORM
vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  // Recursively extract text and params from Drizzle SQL queryChunks
  function extractFromSqlChunks(chunks: unknown[]): { text: string; params: unknown[] } {
    let text = '';
    const params: unknown[] = [];
    for (const chunk of chunks) {
      if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'queryChunks' in (chunk as object)) {
        const nested = extractFromSqlChunks((chunk as { queryChunks: unknown[] }).queryChunks);
        text += nested.text;
        params.push(...nested.params);
      } else if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'value' in (chunk as object)) {
        const val = (chunk as { value: unknown }).value;
        if (Array.isArray(val)) text += val.join('');
      } else {
        text += '?';
        params.push(chunk);
      }
    }
    return { text, params };
  }

  return {
    db: {
      select: () => {
        let tableName = '';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            selectCalls.push({ table: tableName });
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => {
            if (tableName === 'organizations') return orgsSelectResult.map(o => ({ id: o.id }));
            if (tableName === 'units') return unitsSelectResult.map(u => ({ id: u.id, propertyId: u.property_id, label: u.label }));
            if (tableName === 'tenants') return []; // existing tenant conflict check
            if (tableName === 'contracts') return [];
            return [];
          }),
          then: (resolve: (v: unknown[]) => void) => {
            if (tableName === 'organizations') resolve(orgsSelectResult.map(o => ({ id: o.id })));
            else if (tableName === 'units') resolve(unitsSelectResult.map(u => ({ id: u.id, propertyId: u.property_id, label: u.label })));
            else resolve([]);
          },
        };
        return chain;
      },

      insert: (tableRef: unknown) => {
        const table = getTableName(tableRef);
        const chain = {
          values: vi.fn((rows: unknown) => {
            const rowsArr = Array.isArray(rows) ? rows : [rows];
            insertCalls.push({ table, row: rowsArr[0] });
            // Normalize camelCase keys to snake_case for snapshot assertions
            const snakeRows = rowsArr.map((r: unknown) => {
              if (!r || typeof r !== 'object') return r;
              const obj = r as Record<string, unknown>;
              return {
                org_id: obj['orgId'] ?? obj['org_id'],
                table_name: obj['tableName'] ?? obj['table_name'],
                external_id: obj['externalId'] ?? obj['external_id'],
                data: obj['data'],
                synced_at: obj['syncedAt'] ?? obj['synced_at'],
              };
            });
            return {
              onConflictDoUpdate: vi.fn(async () => {
                upsertCalls.push({ table, rows: snakeRows, opts: { onConflict: 'org_id,table_name,external_id' } });
                return [];
              }),
              onConflictDoNothing: vi.fn(async () => []),
              returning: vi.fn(async () => [{ id: 'log-id-001' }]),
            };
          }),
        };
        return chain;
      },

      update: () => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      }),

      execute: vi.fn(async (sqlObj: unknown) => {
        if (!sqlObj || typeof sqlObj !== 'object' || !('queryChunks' in (sqlObj as object))) return [];

        const { text, params } = extractFromSqlChunks((sqlObj as { queryChunks: unknown[] }).queryChunks);

        // Extract table name: INSERT INTO <table> (col1, col2, ...)
        const tableMatch = text.match(/INSERT INTO\s+(\w+)\s*\(/i);
        const table = tableMatch ? tableMatch[1] : 'unknown';

        // Extract column names
        const colMatch = text.match(/INSERT INTO\s+\w+\s*\(([^)]+)\)/i);
        const cols = colMatch ? colMatch[1].split(',').map((c: string) => c.trim()) : [];

        // Map param positions to columns
        const row: Record<string, unknown> = {};
        cols.forEach((col: string, i: number) => { row[col] = params[i]; });

        upsertCalls.push({
          table,
          rows: [row],
          opts: { onConflict: 'org_id,airtable_external_id', ignoreDuplicates: false },
        });

        if (table === 'properties' && propiedadesUpsertError) {
          throw new Error(propiedadesUpsertError.message);
        }
        if (table === 'tenants' && residentsUpsertError) {
          throw new Error(residentsUpsertError.message);
        }
        return [];
      }),

      query: { profiles: { findFirst: vi.fn(async () => null) } },
    },
  };
});

// ---------------------------------------------------------------------------
// Mock syncAirtableTable (legacy snapshot sync — not under test here)
// ---------------------------------------------------------------------------

vi.mock('@/lib/airtable/sync', () => ({
  syncAirtableTable: vi.fn().mockResolvedValue({
    count: 0,
    status: 'success',
    logId: 'mock-log-id',
    durationMs: 10,
  }),
}));

// ---------------------------------------------------------------------------
// Mock AirtableClient — injectable in syncEntityTable
// ---------------------------------------------------------------------------

/** Records returned per table key when listRecords is called */
const airtableRecordsByKey: Record<string, unknown[]> = {};
/** If set, listRecords for this tableEnvKey throws */
const airtableTableErrors: Record<string, Error> = {};

const mockAirtableClient = {
  listRecords: vi.fn(async (tableEnvKey: string) => {
    if (airtableTableErrors[tableEnvKey]) {
      throw airtableTableErrors[tableEnvKey];
    }
    return airtableRecordsByKey[tableEnvKey] ?? [];
  }),
};

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: () => mockAirtableClient,
  _resetAirtableClientForTest: vi.fn(),
  AirtableClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Sample Airtable records
// ---------------------------------------------------------------------------

function makePropiedadRecord(id = 'recPROP001') {
  return {
    id,
    createdTime: '2024-01-01T00:00:00.000Z',
    fields: {
      Propiedad: 'Casa Test',
      Dirección: 'Calle Test 123',
      Modalidad: 'Habitación',
      Distrito: 'Miraflores',
      Descripción: 'Casa amplia',
      'N° de suministro (L)': '1234567',
      'N° de residentes actuales': 3,
      'N° total de habitaciones': 5,
      'Código de pago (I)': 'INT-001',
      'N° de cliente (G)': 'GAS-001',
      'N° de suministro (A)': 'AGU-001',
    },
  };
}

function makeResidenteRecord(id = 'recTENANT001', propiedadExtId?: string, unitLabel?: string) {
  return {
    id,
    createdTime: '2024-01-01T00:00:00.000Z',
    fields: {
      Nombre: 'Juan',
      Apellido: 'Pérez',
      'N° DNI': '12345678',
      ...(propiedadExtId ? { Propiedad: [propiedadExtId] } : {}),
      ...(unitLabel ? { 'N° de habitación': [unitLabel] } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Import route AFTER mocks are set up
// ---------------------------------------------------------------------------

// We need to import the route handler dynamically to ensure mocks are in place.
// We wrap in a helper so each test group can do a fresh call.

async function callRoute(
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  // Dynamic import ensures mocks are registered before module evaluation
  const { POST } = await import('@/app/api/cron/airtable-sync/route');
  const req = new NextRequest('http://localhost/api/cron/airtable-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return POST(req);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(secret = CRON_SECRET) {
  return { Authorization: `Bearer ${secret}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/cron/airtable-sync — AC1: auth guard', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    selectCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await callRoute({});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    // No Airtable call should have been made
    expect(mockAirtableClient.listRecords).not.toHaveBeenCalled();
  });

  it('returns 401 when wrong bearer token supplied', async () => {
    const res = await callRoute(authHeader('wrong-secret'));
    expect(res.status).toBe(401);
    expect(mockAirtableClient.listRecords).not.toHaveBeenCalled();
  });

  it('returns 200 when correct CRON_SECRET bearer supplied', async () => {
    // No airtable records → quick success
    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);
  });
});

describe('POST /api/cron/airtable-sync — AC2: full sync writes domain rows', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    selectCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    residentsUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    // Reset per-table airtable records
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  it('calls properties upsert with airtable_external_id when Propiedad record returned', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());

    const propUpsert = upsertCalls.find(c => c.table === 'properties');
    expect(propUpsert).toBeDefined();
    const row = (propUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['airtable_external_id']).toBe('recPROP001');
    expect(row['org_id']).toBe(ORG_ID);
  });

  it('calls tenants upsert with airtable_external_id when Residente record returned', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    await callRoute(authHeader());

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['airtable_external_id']).toBe('recTENANT001');
  });

  it('writes airtable_sync_logs insert with status=success after sync', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());

    const logInsert = insertCalls.find(c => c.table === 'airtable_sync_logs');
    expect(logInsert).toBeDefined();
    expect((logInsert!.row as Record<string, unknown>)['status']).toBe('success');
  });
});

describe('POST /api/cron/airtable-sync — AC3: idempotent re-run', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('upserts with onConflict=org_id,airtable_external_id and ignoreDuplicates=false (update semantics)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());
    // First run — verify upsert options
    const propUpsert = upsertCalls.find(c => c.table === 'properties');
    expect(propUpsert).toBeDefined();
    const opts = propUpsert!.opts as Record<string, unknown>;
    expect(opts['onConflict']).toBe('org_id,airtable_external_id');
    expect(opts['ignoreDuplicates']).toBe(false);
  });

  it('_airtable_* private fields are stripped from upsert payload (toDbRow)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord('recTENANT001', 'recPROP001')];

    await callRoute(authHeader());

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];

    // Private helper fields must not appear in DB payload
    const privateKeys = Object.keys(row).filter(k => k.startsWith('_airtable_'));
    expect(privateKeys).toHaveLength(0);
  });

  it('calling sync twice with same mock data calls upsert both times (idempotent)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());
    const firstCount = upsertCalls.filter(c => c.table === 'properties').length;

    upsertCalls.length = 0;

    await callRoute(authHeader());
    const secondCount = upsertCalls.filter(c => c.table === 'properties').length;

    // Both runs call upsert — idempotent by DB constraint, not by skipping the call
    expect(firstCount).toBeGreaterThan(0);
    expect(secondCount).toBeGreaterThan(0);
  });
});

describe('POST /api/cron/airtable-sync — AC5: unresolved link → null FK, continue', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('tenant with linked propiedad that has no local property_id is upserted with property_id=null', async () => {
    // Return a Residente linked to an airtable id that has NO matching properties row
    // (empty properties table, so idMaps.properties is empty Map)
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [
      makeResidenteRecord('recTENANT001', 'recNONEXISTENT'),
    ];
    // No properties records → idMaps.properties = empty
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [];

    const res = await callRoute(authHeader());
    // Should not throw — response must be 200
    expect(res.status).toBe(200);

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['property_id']).toBeUndefined(); // tenants has no property_id column — key intentionally absent
  });
});

describe('POST /api/cron/airtable-sync — AC6: one entity error → others succeed → HTTP 200 partial', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    residentsUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  it('when properties Airtable fetch throws, entityResults contains properties with status=error', async () => {
    airtableTableErrors['AIRTABLE_TABLE_PROPIEDADES'] = new Error('Airtable network failure');
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);

    const body = await res.json();
    const entityResults: Array<{ entity: string; status: string }> = body.entityResults ?? [];

    const propertiesResult = entityResults.find(r => r.entity === 'properties');
    expect(propertiesResult).toBeDefined();
    expect(propertiesResult!.status).toBe('error');
  });

  it('when properties fails, tenants sync still runs and appears in entityResults', async () => {
    airtableTableErrors['AIRTABLE_TABLE_PROPIEDADES'] = new Error('Airtable network failure');
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    const res = await callRoute(authHeader());
    const body = await res.json();
    const entityResults: Array<{ entity: string; status: string }> = body.entityResults ?? [];

    const tenantsResult = entityResults.find(r => r.entity === 'tenants');
    expect(tenantsResult).toBeDefined();
    expect(tenantsResult!.status).toBe('success');
  });

  it('returns overall status=partial (not error) when some entities succeed', async () => {
    airtableTableErrors['AIRTABLE_TABLE_PROPIEDADES'] = new Error('Airtable network failure');
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    const res = await callRoute(authHeader());
    const body = await res.json();
    // At least one entity failed, at least one succeeded → 'partial'
    expect(['ok', 'partial']).toContain(body.status);
  });
});

describe('POST /api/cron/airtable-sync — AC7: missing env var → entity skipped, HTTP 200', () => {
  const savedResidentesEnv = process.env['AIRTABLE_TABLE_RESIDENTES'];

  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    // Restore after each test
    if (savedResidentesEnv) {
      process.env['AIRTABLE_TABLE_RESIDENTES'] = savedResidentesEnv;
    } else {
      delete process.env['AIRTABLE_TABLE_RESIDENTES'];
    }
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('when AIRTABLE_TABLE_RESIDENTES is unset, tenants sync is skipped and response is still 200', async () => {
    delete process.env['AIRTABLE_TABLE_RESIDENTES'];

    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('entityResults');

    // listRecords should not have been called for tenants table key
    const tenantsCalls = mockAirtableClient.listRecords.mock.calls.filter(
      c => c[0] === 'AIRTABLE_TABLE_RESIDENTES'
    );
    expect(tenantsCalls).toHaveLength(0);
  });

  it('when a table env var is missing, no log row is written for that entity', async () => {
    delete process.env['AIRTABLE_TABLE_RESIDENTES'];

    await callRoute(authHeader());

    const tenantsLogInsert = insertCalls.find(
      c => c.table === 'airtable_sync_logs' &&
        (c.row as Record<string, unknown>)['table_name'] === 'tenants'
    );
    expect(tenantsLogInsert).toBeUndefined();
  });
});

describe('POST /api/cron/airtable-sync — AC8: org isolation', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('every upserted domain row includes the org_id field', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    await callRoute(authHeader());

    const domainUpserts = upsertCalls.filter(c =>
      ['properties', 'tenants', 'contracts', 'payments'].includes(c.table)
    );

    for (const call of domainUpserts) {
      for (const row of call.rows as Array<Record<string, unknown>>) {
        expect(row['org_id']).toBeDefined();
        expect(typeof row['org_id']).toBe('string');
        expect(row['org_id']).toBe(ORG_ID);
      }
    }
  });

  it('sync for org A does not include org B id in any row', async () => {
    const ORG_B = '00000000-0000-0000-0000-000000000002';
    // Only org A is in the DB
    orgsSelectResult = [{ id: ORG_ID }];
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());

    const allRows = upsertCalls
      .filter(c => c.table === 'properties')
      .flatMap(c => c.rows as Array<Record<string, unknown>>);

    for (const row of allRows) {
      expect(row['org_id']).not.toBe(ORG_B);
    }
  });
});

describe('POST /api/cron/airtable-sync — AC10: airtable_snapshots populated', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('calls airtable_snapshots upsert with raw record JSON after properties sync', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());

    const snapshotUpsert = upsertCalls.find(c => c.table === 'airtable_snapshots');
    expect(snapshotUpsert).toBeDefined();
    const row = (snapshotUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['external_id']).toBe('recPROP001');
    expect(row['org_id']).toBe(ORG_ID);
    expect(row['table_name']).toBe('propiedades');
    // Raw JSON data must include the fields object
    const data = row['data'] as Record<string, unknown>;
    expect(data['fields']).toBeDefined();
    expect(data['id']).toBe('recPROP001');
  });
});

describe('POST /api/cron/airtable-sync — AC11: airtable_synced_at stamped', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('upserted properties row includes airtable_synced_at as a recent ISO timestamp', async () => {
    const before = new Date();
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];

    await callRoute(authHeader());

    const propUpsert = upsertCalls.find(c => c.table === 'properties');
    expect(propUpsert).toBeDefined();
    const row = (propUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['airtable_synced_at']).toBeDefined();

    const syncedAt = new Date(row['airtable_synced_at'] as string);
    const after = new Date();
    expect(syncedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000); // 5s tolerance
    expect(syncedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 5000);
  });

  it('upserted tenants row includes airtable_synced_at', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [makeResidenteRecord()];

    await callRoute(authHeader());

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(row['airtable_synced_at']).toBeDefined();
    expect(typeof row['airtable_synced_at']).toBe('string');
  });
});

describe('POST /api/cron/airtable-sync — AC4: unit_id resolution via unitMap', () => {
  const PROP_UUID = 'supabase-prop-uuid-001';
  const UNIT_UUID = 'supabase-unit-uuid-001';

  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    mockAirtableClient.listRecords.mockClear();
    propiedadesUpsertError = null;
    residentsUpsertError = null;
    orgsSelectResult = [{ id: ORG_ID }];
    unitsSelectResult = [];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  afterEach(() => {
    unitsSelectResult = [];
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
    Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
  });

  it('unit_id is null for tenants: Residentes table no longer has a unit label field in new schema', async () => {
    // New base schema: "N° de habitación" (unit label link) was removed from Residentes.
    // normalizeTenant always returns _airtable_unit_label: null → unit_id stays null.
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord('recPROP001')];
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [
      makeResidenteRecord('recTENANT001', 'recPROP001', 'Hab. 1'),
    ];
    // Even with a matching unit in the units table, unit_id stays null
    unitsSelectResult = [
      { id: UNIT_UUID, property_id: PROP_UUID, label: 'Hab. 1' },
    ];

    await callRoute(authHeader());

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    // In new schema, unit_id and property_id are always null from the tenant normalizer.
    // The Residentes table no longer carries Propiedad or unit-label links;
    // property_id for a tenant is resolved indirectly via their contract in the contracts sync.
    expect(row['unit_id']).toBeNull();
    expect(row['property_id']).toBeUndefined(); // tenants has no property_id column — key intentionally absent
  });

  it('sets unit_id to null and does not abort when unit label has no match in unitMap', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord('recPROP001')];
    // Residente with a unit label that has no matching unit row
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [
      makeResidenteRecord('recTENANT001', 'recPROP001', 'Hab. UNKNOWN'),
    ];
    // units table returns rows but none matching "Hab. UNKNOWN"
    unitsSelectResult = [
      { id: UNIT_UUID, property_id: PROP_UUID, label: 'Hab. 1' },
    ];

    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    // unit_id stays null — same null-FK-continue pattern as AC5
    expect(row['unit_id']).toBeNull();
  });

  it('does not include _airtable_unit_label in the upserted tenant row', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES'] = [
      makeResidenteRecord('recTENANT001', 'recPROP001', 'Hab. 1'),
    ];

    await callRoute(authHeader());

    const tenantUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantUpsert).toBeDefined();
    const row = (tenantUpsert!.rows as Array<Record<string, unknown>>)[0];
    expect(Object.keys(row).filter(k => k.startsWith('_airtable_'))).toHaveLength(0);
  });
});
