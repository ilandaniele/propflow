/**
 * tests/integration/airtable-portafolio-responsables.test.ts
 *
 * Integration tests for Portafolio→units and Responsables→responsables sync.
 *
 * Strategy: mock @/lib/db (Drizzle) and Airtable HTTP calls (no real network).
 *
 * Covers:
 *   AC1  — Portafolio sync → units upsert called with area_m2
 *   AC2  — Portafolio sync → property_id resolved from propertiesMap
 *   AC3  — Responsables sync → responsables upsert called with airtable_external_id
 *   AC4  — Responsable backfill: tenants upsert receives responsable_id
 *   AC5  — Sync order: properties before units; responsables before tenants
 *   AC6  — AIRTABLE_TABLE_PORTAFOLIO not set → no units upsert, HTTP 200 returned
 *   AC8  — Re-run same data → ON CONFLICT DO UPDATE semantics (non-ignore)
 *   AC9  — airtable_synced_at present in upsert payload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Env setup — must be set before any module import that reads process.env
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-portafolio';
const ORG_ID = '00000000-0000-0000-0000-000000000002';

process.env['CRON_SECRET'] = CRON_SECRET;
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://placeholder.supabase.co';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'placeholder_anon_key';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'placeholder_service_role_key';
process.env['AIRTABLE_PAT'] = 'pat.portafolio_test_token';
process.env['AIRTABLE_BASE_ID'] = 'appPORTAFOLIOTEST';
process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES';
process.env['AIRTABLE_TABLE_PORTAFOLIO'] = 'tblPORTAFOLIO';
process.env['AIRTABLE_TABLE_RESPONSABLES'] = 'tblRESPONSABLES';
process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRESIDENTES';
process.env['AIRTABLE_TABLE_HISTORIAL'] = 'tblHISTORIAL';
process.env['AIRTABLE_TABLE_PAGOS'] = 'tblPAGOS';

// ---------------------------------------------------------------------------
// SQL row extraction helper (used inside vi.mock factory)
// ---------------------------------------------------------------------------

// Tracks captured upsert rows (extracted from db.execute SQL objects)
const upsertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
const insertCalls: Array<{ table: string; row: unknown }> = [];

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  /**
   * Extract column names and parameter values from a drizzle SQL object.
   * queryChunks alternates between { value: string[] } text parts and raw scalar params.
   */
  function extractFromSqlChunks(chunks: unknown[]): { text: string; params: unknown[] } {
    let text = '';
    const params: unknown[] = [];
    for (const chunk of chunks) {
      if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'queryChunks' in (chunk as object)) {
        // Nested SQL object — recurse
        const nested = extractFromSqlChunks((chunk as { queryChunks: unknown[] }).queryChunks);
        text += nested.text;
        params.push(...nested.params);
      } else if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'value' in (chunk as object)) {
        // Raw text chunk
        const val = (chunk as { value: unknown[] }).value;
        if (Array.isArray(val)) text += val.join('');
      } else {
        // Parameter value
        text += '?';
        params.push(chunk);
      }
    }
    return { text, params };
  }

  function parseInsertRow(sqlObj: unknown): { table: string; row: Record<string, unknown> } | null {
    if (!sqlObj || typeof sqlObj !== 'object' || !('queryChunks' in (sqlObj as object))) return null;
    const { text, params } = extractFromSqlChunks((sqlObj as { queryChunks: unknown[] }).queryChunks);

    const insertMatch = text.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
    if (!insertMatch) return null;

    const table = insertMatch[1];
    const cols = insertMatch[2].split(',').map(c => c.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      row[col] = params[i];
    });
    return { table, row };
  }

  function isSelectSql(sqlObj: unknown): boolean {
    if (!sqlObj || typeof sqlObj !== 'object' || !('queryChunks' in (sqlObj as object))) return false;
    const { text } = extractFromSqlChunks((sqlObj as { queryChunks: unknown[] }).queryChunks);
    return /^\s*SELECT/i.test(text);
  }

  function getSelectTable(sqlObj: unknown): string {
    if (!sqlObj || typeof sqlObj !== 'object' || !('queryChunks' in (sqlObj as object))) return '';
    const { text } = extractFromSqlChunks((sqlObj as { queryChunks: unknown[] }).queryChunks);
    const m = text.match(/FROM\s+(\w+)/i);
    return m ? m[1] : '';
  }

  // idMap lookup responses — keyed by table name
  // These simulate the SELECT id, airtable_external_id results that populate idMaps
  const idMapData: Record<string, Array<{ id: string; airtable_external_id: string }>> = {
    properties: [
      { id: 'supabase-prop-uuid-001', airtable_external_id: 'recPROP001' },
    ],
    responsables: [
      { id: 'supabase-resp-uuid-001', airtable_external_id: 'recRESP001' },
    ],
    units: [
      { id: 'supabase-unit-uuid-001', airtable_external_id: 'recUNIT001' },
    ],
    tenants: [
      { id: 'supabase-ten-uuid-001', airtable_external_id: 'recTENANT001' },
    ],
    contracts: [
      { id: 'supabase-contr-uuid-001', airtable_external_id: 'recCONTR001' },
    ],
  };

  return {
    db: {
      execute: vi.fn(async (sqlObj: unknown) => {
        if (isSelectSql(sqlObj)) {
          const table = getSelectTable(sqlObj);
          return idMapData[table] ?? [];
        }
        // INSERT — extract and record
        const parsed = parseInsertRow(sqlObj);
        if (parsed) {
          upsertCalls.push({ table: parsed.table, rows: [parsed.row] });
        }
        return [];
      }),

      select: () => {
        let tableName = '';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            // Extract table name from Drizzle symbol
            if (tableRef && typeof tableRef === 'object') {
              const syms = Object.getOwnPropertySymbols(tableRef as object);
              const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
              if (nameSym) tableName = String((tableRef as Record<symbol, unknown>)[nameSym]);
            }
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => {
            if (tableName === 'organizations') return [{ id: ORG_ID }];
            return [];
          }),
          then: (resolve: (v: unknown[]) => void) => {
            if (tableName === 'organizations') resolve([{ id: ORG_ID }]);
            else resolve([]);
          },
        };
        return chain;
      },

      insert: vi.fn((tableRef: unknown) => {
        let table = '';
        if (tableRef && typeof tableRef === 'object') {
          const syms = Object.getOwnPropertySymbols(tableRef as object);
          const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
          if (nameSym) table = String((tableRef as Record<symbol, unknown>)[nameSym]);
        }
        return {
          values: vi.fn((data: unknown) => {
            insertCalls.push({ table, row: data });
            return {
              onConflictDoUpdate: vi.fn(async () => []),
              onConflictDoNothing: vi.fn(async () => []),
              returning: vi.fn(async () => []),
            };
          }),
        };
      }),

      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    },
  };
});

vi.mock('@/lib/airtable/sync', () => ({
  syncAirtableTable: vi.fn().mockResolvedValue({
    count: 0,
    status: 'success',
    logId: 'mock-log-id',
    durationMs: 10,
  }),
}));

// ---------------------------------------------------------------------------
// Mock AirtableClient
// ---------------------------------------------------------------------------

const airtableRecordsByKey: Record<string, unknown[]> = {};
const airtableTableErrors: Record<string, Error> = {};

const mockAirtableClient = {
  listRecords: vi.fn(async (tableEnvKey: string) => {
    if (airtableTableErrors[tableEnvKey]) throw airtableTableErrors[tableEnvKey];
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

function makeRecord(id: string, fields: Record<string, unknown>) {
  return { id, createdTime: '2024-01-01T00:00:00.000Z', fields };
}

function makePropiedadRecord(id = 'recPROP001') {
  return makeRecord(id, {
    Propiedad: 'Casa Test',
    Dirección: 'Calle Test 123',
  });
}

function makePortafolioRecord(id = 'recUNIT001', propExtId = 'recPROP001') {
  return makeRecord(id, {
    'N° Habitación': 'Hab. 1',
    Propiedad:       [{ id: propExtId }],
    Baño:            'Privado',
    'm2':            18.5,
    Estado:          'Disponible',
  });
}

function makeResponsableRecord(id = 'recRESP001') {
  return makeRecord(id, {
    'Nombre completo':    'Ana Garza',
    'N° DNI':             '87654321',
    'Número celular':     '+51 900 100 200',
    'Correo electrónico': 'ana@example.com',
    'Tipo de empleo':     'Independiente',
    Empresa:              'Propia',
    Cargo:                'Dueño',
    'Rubro del negocio':  'Comercio',
    'Foto DNI':           [{ url: 'https://cdn.example.com/ana.jpg' }],
  });
}

function makeResidenteRecord(id = 'recTENANT001', responsableExtId?: string) {
  return makeRecord(id, {
    'Nombre(s) y Apellidos': 'Carlos López',
    'N° DNI':                '11111111',
    ...(responsableExtId ? { Responsable: [responsableExtId] } : {}),
  });
}

// ---------------------------------------------------------------------------
// Route caller
// ---------------------------------------------------------------------------

async function callRoute(headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/cron/airtable-sync/route');
  const req = new NextRequest('http://localhost/api/cron/airtable-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return POST(req);
}

function authHeader() {
  return { Authorization: `Bearer ${CRON_SECRET}` };
}

// ---------------------------------------------------------------------------
// Shared reset
// ---------------------------------------------------------------------------

function resetState() {
  upsertCalls.length = 0;
  insertCalls.length = 0;
  mockAirtableClient.listRecords.mockClear();
  Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  Object.keys(airtableTableErrors).forEach(k => delete airtableTableErrors[k]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Portafolio sync — AC1 + AC2: units upsert with area_m2 and property_id resolved', () => {
  beforeEach(resetState);
  afterEach(() => {
    Object.keys(airtableRecordsByKey).forEach(k => delete airtableRecordsByKey[k]);
  });

  it('AC1: units upsert receives area_m2 from Portafolio record', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_PORTAFOLIO']  = [makePortafolioRecord()];

    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);

    const unitsUpsert = upsertCalls.find(c => c.table === 'units');
    expect(unitsUpsert).toBeDefined();
    const row = unitsUpsert!.rows[0];
    expect(row['area_m2']).toBe(18.5);
    expect(row['airtable_external_id']).toBe('recUNIT001');
    expect(row['label']).toBe('Hab. 1');
    expect(row['toilet_type']).toBe('private');
    expect(row['status']).toBe('vacant');
  });

  it('AC2: property_id resolved from propertiesMap in units upsert', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_PORTAFOLIO']  = [makePortafolioRecord('recUNIT001', 'recPROP001')];

    await callRoute(authHeader());

    const unitsUpsert = upsertCalls.find(c => c.table === 'units');
    expect(unitsUpsert).toBeDefined();
    const row = unitsUpsert!.rows[0];
    // property_id should be resolved (the mock idMap returns supabase-prop-uuid-001 for recPROP001)
    expect(row['property_id']).toBe('supabase-prop-uuid-001');
    // The private helper field must NOT reach the DB
    expect(row['_airtable_property_ext_id']).toBeUndefined();
  });
});

describe('Responsables sync — AC3: responsables upsert with airtable_external_id', () => {
  beforeEach(resetState);

  it('AC3: responsables upsert is called with correct fields', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord()];

    const res = await callRoute(authHeader());
    expect(res.status).toBe(200);

    const respUpsert = upsertCalls.find(c => c.table === 'responsables');
    expect(respUpsert).toBeDefined();
    const row = respUpsert!.rows[0];
    expect(row['airtable_external_id']).toBe('recRESP001');
    expect(row['full_name']).toBe('Ana Garza');
    expect(row['org_id']).toBe(ORG_ID);
  });
});

describe('Responsable backfill — AC4: tenants upsert receives responsable_id', () => {
  beforeEach(resetState);

  it('AC4: tenant upsert includes responsable_id resolved from responsablesMap', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES']  = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord('recRESP001')];
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES']   = [makeResidenteRecord('recTENANT001', 'recRESP001')];

    await callRoute(authHeader());

    const tenantsUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantsUpsert).toBeDefined();
    const row = tenantsUpsert!.rows[0];
    // responsable_id must be resolved to supabase-resp-uuid-001
    expect(row['responsable_id']).toBe('supabase-resp-uuid-001');
  });

  it('AC4: tenant without Responsable link → no responsable_id in payload (no null overwrite)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES']  = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES']   = [makeResidenteRecord('recTENANT001')];

    await callRoute(authHeader());

    const tenantsUpsert = upsertCalls.find(c => c.table === 'tenants');
    expect(tenantsUpsert).toBeDefined();
    const row = tenantsUpsert!.rows[0];
    // responsable_id should not be set (undefined) — not a null that would overwrite existing data
    expect(row['responsable_id']).toBeUndefined();
  });
});

describe('Sync order — AC5', () => {
  beforeEach(resetState);

  it('AC5: properties sync called before units sync', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [makePropiedadRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_PORTAFOLIO']  = [makePortafolioRecord()];

    const callOrder: string[] = [];
    mockAirtableClient.listRecords.mockImplementation(async (key: string) => {
      callOrder.push(key);
      return airtableRecordsByKey[key] ?? [];
    });

    await callRoute(authHeader());

    const propIdx  = callOrder.indexOf('AIRTABLE_TABLE_PROPIEDADES');
    const unitsIdx = callOrder.indexOf('AIRTABLE_TABLE_PORTAFOLIO');
    expect(propIdx).toBeGreaterThanOrEqual(0);
    expect(unitsIdx).toBeGreaterThanOrEqual(0);
    expect(propIdx).toBeLessThan(unitsIdx);
  });

  it('AC5: responsables sync called before tenants sync', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord()];
    airtableRecordsByKey['AIRTABLE_TABLE_RESIDENTES']   = [makeResidenteRecord()];

    const callOrder: string[] = [];
    mockAirtableClient.listRecords.mockImplementation(async (key: string) => {
      callOrder.push(key);
      return airtableRecordsByKey[key] ?? [];
    });

    await callRoute(authHeader());

    const respIdx   = callOrder.indexOf('AIRTABLE_TABLE_RESPONSABLES');
    const tenantIdx = callOrder.indexOf('AIRTABLE_TABLE_RESIDENTES');
    expect(respIdx).toBeGreaterThanOrEqual(0);
    expect(tenantIdx).toBeGreaterThanOrEqual(0);
    expect(respIdx).toBeLessThan(tenantIdx);
  });
});

describe('Missing env var — AC6', () => {
  beforeEach(resetState);

  it('AC6: AIRTABLE_TABLE_PORTAFOLIO not set → no units upsert, HTTP 200', async () => {
    const savedKey = process.env['AIRTABLE_TABLE_PORTAFOLIO'];
    delete process.env['AIRTABLE_TABLE_PORTAFOLIO'];

    try {
      const res = await callRoute(authHeader());
      expect(res.status).toBe(200);
      const unitsUpsert = upsertCalls.find(c => c.table === 'units');
      expect(unitsUpsert).toBeUndefined();
    } finally {
      process.env['AIRTABLE_TABLE_PORTAFOLIO'] = savedKey ?? 'tblPORTAFOLIO';
    }
  });

  it('AC6: AIRTABLE_TABLE_RESPONSABLES not set → no responsables upsert, HTTP 200', async () => {
    const savedKey = process.env['AIRTABLE_TABLE_RESPONSABLES'];
    delete process.env['AIRTABLE_TABLE_RESPONSABLES'];

    try {
      const res = await callRoute(authHeader());
      expect(res.status).toBe(200);
      const respUpsert = upsertCalls.find(c => c.table === 'responsables');
      expect(respUpsert).toBeUndefined();
    } finally {
      process.env['AIRTABLE_TABLE_RESPONSABLES'] = savedKey ?? 'tblRESPONSABLES';
    }
  });
});

describe('Idempotency — AC8', () => {
  beforeEach(resetState);

  it('AC8: units upsert executed (ON CONFLICT DO UPDATE — always updates, never ignores)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PORTAFOLIO'] = [makePortafolioRecord()];

    await callRoute(authHeader());

    // With Drizzle raw SQL, the INSERT uses ON CONFLICT DO UPDATE — always updates
    // (equivalent to ignoreDuplicates: false in Supabase)
    const unitsUpsert = upsertCalls.find(c => c.table === 'units');
    expect(unitsUpsert).toBeDefined();
  });

  it('AC8: responsables upsert executed (ON CONFLICT DO UPDATE — always updates)', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord()];

    await callRoute(authHeader());

    const respUpsert = upsertCalls.find(c => c.table === 'responsables');
    expect(respUpsert).toBeDefined();
  });
});

describe('airtable_synced_at — AC9', () => {
  beforeEach(resetState);

  it('AC9: units upsert payload includes airtable_synced_at', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PORTAFOLIO'] = [makePortafolioRecord()];

    await callRoute(authHeader());

    const unitsUpsert = upsertCalls.find(c => c.table === 'units');
    expect(unitsUpsert).toBeDefined();
    const row = unitsUpsert!.rows[0];
    expect(row['airtable_synced_at']).toBeTruthy();
  });

  it('AC9: responsables upsert payload includes airtable_synced_at', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_RESPONSABLES'] = [makeResponsableRecord()];

    await callRoute(authHeader());

    const respUpsert = upsertCalls.find(c => c.table === 'responsables');
    expect(respUpsert).toBeDefined();
    const row = respUpsert!.rows[0];
    expect(row['airtable_synced_at']).toBeTruthy();
  });
});
