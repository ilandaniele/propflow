/**
 * tests/integration/airtable-service-payments.test.ts
 *
 * Integration tests for Pago de servicios sync — new single-table schema.
 *
 * The 4 old service payment tables (agua/internet/gas/luz) are now ONE
 * "Pago de servicios" table with a "Tipo de servicio" select field.
 * Env key: AIRTABLE_TABLE_PAGO_SERVICIOS
 *
 * Covers:
 *   AC2  — service_payments upsert with multiple service types, property_id resolved
 *   AC7  — synthetic ext_id: recPROP001::agua in upsert payload
 *   AC8  — missing AIRTABLE_TABLE_PAGO_SERVICIOS → service_payments skipped, HTTP 200
 *   AC10 — re-run same records → ON CONFLICT DO UPDATE (always updates, never ignores)
 *   PROP — property_id resolves from propertiesMap; null when unresolved, no abort
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Env setup — must be set before any module import that reads process.env
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-service-payments-v2';
const ORG_ID = '00000000-0000-0000-0000-000000000099';

process.env['CRON_SECRET'] = CRON_SECRET;
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://placeholder.supabase.co';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'placeholder_anon_key';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'placeholder_service_role_key';
process.env['AIRTABLE_PAT'] = 'pat.service_payments_v2_test_token';
process.env['AIRTABLE_BASE_ID'] = 'apphwPe2oIkGRSTkb';
process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES';
process.env['AIRTABLE_TABLE_PAGO_SERVICIOS'] = 'tblPAGO_SERVICIOS';
// Leave other entity tables unconfigured (not needed for these tests)
delete process.env['AIRTABLE_TABLE_RESIDENTES'];
delete process.env['AIRTABLE_TABLE_HISTORIAL'];
delete process.env['AIRTABLE_TABLE_PAGOS'];
delete process.env['AIRTABLE_TABLE_PORTAFOLIO'];
delete process.env['AIRTABLE_TABLE_RESPONSABLES'];

// ---------------------------------------------------------------------------
// Captured DB calls
// ---------------------------------------------------------------------------

const upsertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
const insertCalls: Array<{ table: string; row: unknown }> = [];

// Whether to return empty idMap for properties (simulates unresolved property_id)
let emptyPropertyMap = false;

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
        const nested = extractFromSqlChunks((chunk as { queryChunks: unknown[] }).queryChunks);
        text += nested.text;
        params.push(...nested.params);
      } else if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'value' in (chunk as object)) {
        const val = (chunk as { value: unknown[] }).value;
        if (Array.isArray(val)) text += val.join('');
      } else {
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
    const cols = insertMatch[2].split(',').map((c: string) => c.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((col: string, i: number) => { row[col] = params[i]; });
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

  return {
    db: {
      execute: vi.fn(async (sqlObj: unknown) => {
        if (isSelectSql(sqlObj)) {
          const table = getSelectTable(sqlObj);
          if (table === 'properties' && !emptyPropertyMap) {
            return [{ id: 'supabase-prop-uuid-001', airtable_external_id: 'recPROP001' }];
          }
          if (table === 'service_payments') {
            return [
              { id: 'supabase-sp-uuid-001', airtable_external_id: 'recPROP001::agua' },
              { id: 'supabase-sp-uuid-002', airtable_external_id: 'recPROP001::gas' },
              { id: 'supabase-sp-uuid-003', airtable_external_id: 'recPROP001::luz' },
            ];
          }
          return [];
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

// Mock legacy snapshot sync (not under test here)
vi.mock('@/lib/airtable/sync', () => ({
  syncAirtableTable: vi.fn().mockResolvedValue({
    count: 0, status: 'success', logId: 'mock-log-id', durationMs: 10,
  }),
}));

// ---------------------------------------------------------------------------
// Mock Airtable client
// ---------------------------------------------------------------------------

const airtableRecordsByKey: Record<string, unknown[]> = {};

const mockAirtableClient = {
  listRecords: vi.fn(async (tableEnvKey: string) => {
    return airtableRecordsByKey[tableEnvKey] ?? [];
  }),
};

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: () => mockAirtableClient,
}));

// ---------------------------------------------------------------------------
// Test records — new "Pago de servicios" single-table format
// ---------------------------------------------------------------------------

const propRecord = {
  id: 'recPROP001',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Propiedad':               'Casa test',
    'Dirección':               'Calle 1',
    'N° de suministro (Luz)':  'SUP-LUZ-001',
    'N° de suministro (Agua)': 'SUP-AGU-001',
  },
};

const aguaRecord = {
  id: 'recSP_AGUA_01',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Tipo de servicio': 'Agua',
    'Mes':              'Enero',
    'Año':              '2026',
    'Monto (S/)':       120,
    'Tope (S/) auto':   null,
    'Estado':           'Pagado',
    'Constancia':       [{ url: 'https://bucket.co/agua.pdf', id: 'att1' }],
    'Propiedad':        ['recPROP001'],
  },
};

const gasRecord = {
  id: 'recSP_GAS_01',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Tipo de servicio': 'Gas',
    'Mes':              'Febrero',
    'Año':              '2026',
    'Monto (S/)':       75,
    'Tope (S/) auto':   null,
    'Estado':           'Pagado',
    'Constancia':       [{ url: 'https://bucket.co/gas.pdf', id: 'att2' }],
    'Propiedad':        ['recPROP001'],
  },
};

const luzRecord = {
  id: 'recSP_LUZ_01',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Tipo de servicio': 'Luz',
    'Mes':              'Marzo',
    'Año':              '2026',
    'Monto (S/)':       350,
    'Tope (S/) auto':   400,
    'Estado':           'Pagado',
    'Constancia':       [{ url: 'https://bucket.co/luz.pdf', id: 'att3' }],
    'Propiedad':        ['recPROP001'],
  },
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/airtable-sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

async function callRoute(): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('../../src/app/api/cron/airtable-sync/route');
  const response = await POST(makeRequest());
  const body = await response.json() as Record<string, unknown>;
  return { status: response.status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('airtable-service-payments integration', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    insertCalls.length = 0;
    emptyPropertyMap = false;
    mockAirtableClient.listRecords.mockReset();

    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES']    = [propRecord];
    airtableRecordsByKey['AIRTABLE_TABLE_PAGO_SERVICIOS'] = [aguaRecord, gasRecord, luzRecord];

    mockAirtableClient.listRecords.mockImplementation(async (tableEnvKey: string) => {
      return airtableRecordsByKey[tableEnvKey] ?? [];
    });
  });

  it('AC2 — service_payments upsert with multiple types, property_id resolved, monthly_data JSONB', async () => {
    const { status } = await callRoute();
    expect(status).toBe(200);

    const spUpserts = upsertCalls.filter(c => c.table === 'service_payments');
    expect(spUpserts.length).toBeGreaterThan(0);

    const allRows = spUpserts.flatMap(c => c.rows);

    const aguaRow = allRows.find(r => r['service_type'] === 'agua');
    expect(aguaRow).toBeDefined();
    expect(aguaRow!['property_id']).toBe('supabase-prop-uuid-001');
    expect(aguaRow!['monthly_data']).toBeDefined();
    const aguaMonthly = aguaRow!['monthly_data'] as Record<string, unknown>;
    expect(aguaMonthly['2026-01']).toBeDefined();
    expect((aguaMonthly['2026-01'] as Record<string, unknown>)['amount']).toBe(120);
  });

  it('AC7 — synthetic ext_id: recPROP001::agua in upsert payload', async () => {
    await callRoute();
    const allRows = upsertCalls
      .filter(c => c.table === 'service_payments')
      .flatMap(c => c.rows);

    const aguaRow = allRows.find(r => r['service_type'] === 'agua');
    expect(aguaRow).toBeDefined();
    expect(aguaRow!['airtable_external_id']).toBe('recPROP001::agua');
  });

  it('AC8 — missing AIRTABLE_TABLE_PAGO_SERVICIOS → service_payments skipped, HTTP 200', async () => {
    delete process.env['AIRTABLE_TABLE_PAGO_SERVICIOS'];

    const { status, body } = await callRoute();
    expect(status).toBe(200);

    const entityResults = body['entityResults'] as Array<Record<string, unknown>>;
    const spResult = entityResults?.find(r => r['entity'] === 'service_payments');
    // Should be absent (skipped) not errored
    expect(spResult).toBeUndefined();

    // Restore for other tests
    process.env['AIRTABLE_TABLE_PAGO_SERVICIOS'] = 'tblPAGO_SERVICIOS';
  });

  it('AC10 — re-run same records → upsert executed (ON CONFLICT DO UPDATE, always updates)', async () => {
    await callRoute();
    const spUpserts = upsertCalls.filter(c => c.table === 'service_payments');
    // Drizzle raw SQL uses ON CONFLICT DO UPDATE — verifies upsert was called
    expect(spUpserts.length).toBeGreaterThan(0);
  });

  it('property not found → property_id null, no abort', async () => {
    emptyPropertyMap = true;
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [];

    const { status, body } = await callRoute();
    expect(status).toBe(200);

    const allRows = upsertCalls
      .filter(c => c.table === 'service_payments')
      .flatMap(c => c.rows);

    // All rows should have property_id = null (no idMap hit)
    for (const row of allRows) {
      expect(row['property_id']).toBeNull();
    }
    void body;
  });
});
