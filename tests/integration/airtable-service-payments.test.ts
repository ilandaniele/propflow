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
 *   AC10 — re-run same records → upsert called with ignoreDuplicates: false
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
// Mock Supabase admin client
// ---------------------------------------------------------------------------

const upsertCalls: Array<{ table: string; rows: unknown[]; opts: unknown }> = [];
const insertCalls: Array<{ table: string; row: unknown }> = [];

type UpsertResult = { error: null | { message: string } };
type InsertResult = { error: null | { message: string } };
type SelectResult = { data: unknown[] | null; error: null };

const orgsSelectResult: Array<{ id: string }> = [{ id: ORG_ID }];

function makeSupabaseBuilder(table: string) {
  const builder: Record<string, unknown> = {};

  builder['upsert'] = (rows: unknown[], opts: unknown): UpsertResult => {
    upsertCalls.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts });
    return { error: null };
  };

  builder['insert'] = (row: unknown): InsertResult => {
    insertCalls.push({ table, row });
    return { error: null };
  };

  const eqChain = {
    in: (_col: string, _vals: string[]): SelectResult => {
      if (table === 'properties') {
        return {
          data: [{ id: 'supabase-prop-uuid-001', airtable_external_id: 'recPROP001' }],
          error: null,
        };
      }
      if (table === 'service_payments') {
        return {
          data: [
            { id: 'supabase-sp-uuid-001', airtable_external_id: 'recPROP001::agua' },
            { id: 'supabase-sp-uuid-002', airtable_external_id: 'recPROP001::gas' },
            { id: 'supabase-sp-uuid-003', airtable_external_id: 'recPROP001::luz' },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    },
    eq: function (_col: string, _val: string) { return this; },
  };

  const selectChain = {
    eq: (_col: string, _val: string): typeof eqChain => eqChain,
  };

  builder['select'] = (_cols?: string): typeof selectChain | SelectResult => {
    if (table === 'organizations') {
      return { data: orgsSelectResult, error: null } as SelectResult;
    }
    return selectChain;
  };

  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => makeSupabaseBuilder(table),
  }),
}));

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
    'Propiedad':                  'Casa test',
    'Dirección':                  'Calle 1',
    'N° de suministro (Luz)':     'SUP-LUZ-001',
    'N° de suministro (Agua)':    'SUP-AGU-001',
  },
};

// Three service payment records in the single table
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

    const allRows = spUpserts.flatMap(c => c.rows) as Array<Record<string, unknown>>;

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
      .flatMap(c => c.rows) as Array<Record<string, unknown>>;

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

  it('AC10 — re-run same records → upsert called with ignoreDuplicates: false', async () => {
    await callRoute();
    const spUpserts = upsertCalls.filter(c => c.table === 'service_payments');
    for (const call of spUpserts) {
      const opts = call.opts as Record<string, unknown>;
      expect(opts['ignoreDuplicates']).toBe(false);
    }
  });

  it('property not found → property_id null, no abort', async () => {
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [];

    const { status, body } = await callRoute();
    expect(status).toBe(200);

    const allRows = upsertCalls
      .filter(c => c.table === 'service_payments')
      .flatMap(c => c.rows) as Array<Record<string, unknown>>;

    // All rows should have property_id = null (no idMap hit)
    for (const row of allRows) {
      expect(row['property_id']).toBeNull();
    }
    void body;
  });
});
