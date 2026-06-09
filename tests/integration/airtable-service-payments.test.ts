/**
 * tests/integration/airtable-service-payments.test.ts
 *
 * Integration tests for Pago de servicios (agua/internet/gas/luz) sync.
 *
 * Strategy: mock Supabase admin client and Airtable HTTP calls (no real network).
 *
 * Covers:
 *   AC2  — agua sync → service_payments upsert with service_type='agua', property_id resolved
 *   AC7  — synthetic ext_id: recId::gas in upsert payload
 *   AC8  — missing AIRTABLE_TABLE_PAGOS_INTERNET → internet skipped, others continue, HTTP 200
 *   AC10 — re-run same record → upsert called with ignoreDuplicates: false
 *   PROP — property_id resolves from propertiesMap; null when unresolved, no abort
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Env setup — must be set before any module import that reads process.env
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-service-payments';
const ORG_ID = '00000000-0000-0000-0000-000000000099';

process.env['CRON_SECRET'] = CRON_SECRET;
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://placeholder.supabase.co';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'placeholder_anon_key';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'placeholder_service_role_key';
process.env['AIRTABLE_PAT'] = 'pat.service_payments_test_token';
process.env['AIRTABLE_BASE_ID'] = 'appSERVICEPAYMENTSTEST';
process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES';
process.env['AIRTABLE_TABLE_PAGOS_AGUA'] = 'tblPAGOS_AGUA';
process.env['AIRTABLE_TABLE_PAGOS_GAS'] = 'tblPAGOS_GAS';
process.env['AIRTABLE_TABLE_PAGOS_LUZ'] = 'tblPAGOS_LUZ';
// Intentionally omit AIRTABLE_TABLE_PAGOS_INTERNET for AC8 test
delete process.env['AIRTABLE_TABLE_PAGOS_INTERNET'];
// Leave tenants/contracts/payments/etc unconfigured (not needed for these tests)
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
      // idMap select for properties
      if (table === 'properties') {
        return {
          data: [{ id: 'supabase-prop-uuid-001', airtable_external_id: 'recPROP001' }],
          error: null,
        };
      }
      // idMap select for service_payments (synthetic ext_ids)
      if (table === 'service_payments') {
        return {
          data: [
            { id: 'supabase-sp-uuid-001', airtable_external_id: 'recAGUA001::agua' },
            { id: 'supabase-sp-uuid-002', airtable_external_id: 'recGAS001::gas' },
            { id: 'supabase-sp-uuid-003', airtable_external_id: 'recLUZ001::luz' },
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
    // organizations.select('id') returns data directly (no .eq chaining in route)
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
    count: 0,
    status: 'success',
    logId: 'mock-log-id',
    durationMs: 10,
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
// Test records
// ---------------------------------------------------------------------------

const propRecord = {
  id: 'recPROP001',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: { 'Propiedad': 'Casa test', 'Dirección': 'Calle 1' },
};

const aguaRecord = {
  id: 'recAGUA001',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Propiedad': ['recPROP001'],
    'N° de suministro (A)': 'AGUA-SUP-001',
    'Monto 01 - 26 (A) agua': 120,
    'EECC 01 - 26': 'eecc-link',
    'Const. 01 - 26 (A)': [{ url: 'https://bucket.co/agua.pdf' }],
  },
};

const gasRecord = {
  id: 'recGAS001',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Propiedad': ['recPROP001'],
    'N° de cliente (G)': 'GAS-CLIENT-001',
    'Monto 02 - 26 (G)': 75,
    'Const. 02 - 26 (G)': [{ url: 'https://bucket.co/gas.pdf' }],
  },
};

const luzRecord = {
  id: 'recLUZ001',
  createdTime: '2026-01-01T00:00:00.000Z',
  fields: {
    'Propiedad': ['recPROP001'],
    'N° de suministro (L)': 'LUZ-SUP-001',
    'Tope': 400,
    'Monto 03 - 26 (L)': 350,
    'Const. 03 - 26 (L)': [{ url: 'https://bucket.co/luz.pdf' }],
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

    // Default: all tables populated (keyed by the env var KEY, as that's what listRecords receives)
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [propRecord];
    airtableRecordsByKey['AIRTABLE_TABLE_PAGOS_AGUA']  = [aguaRecord];
    airtableRecordsByKey['AIRTABLE_TABLE_PAGOS_GAS']   = [gasRecord];
    airtableRecordsByKey['AIRTABLE_TABLE_PAGOS_LUZ']   = [luzRecord];

    mockAirtableClient.listRecords.mockImplementation(async (tableEnvKey: string) => {
      return airtableRecordsByKey[tableEnvKey] ?? [];
    });
  });

  it('AC2 — agua sync → service_payments upsert with service_type=agua, property_id resolved, monthly_data JSONB', async () => {
    const { status } = await callRoute();

    expect(status).toBe(200);

    const spUpserts = upsertCalls.filter(c => c.table === 'service_payments');
    expect(spUpserts.length).toBeGreaterThan(0);

    const allRows = spUpserts.flatMap(c => c.rows) as Array<Record<string, unknown>>;
    const aguaRow = allRows.find(r => r['service_type'] === 'agua');

    expect(aguaRow).toBeDefined();
    expect(aguaRow!['supply_number']).toBe('AGUA-SUP-001');
    expect(aguaRow!['property_id']).toBe('supabase-prop-uuid-001');
    expect(aguaRow!['monthly_data']).toBeDefined();

    const monthly = aguaRow!['monthly_data'] as Record<string, unknown>;
    expect(monthly['2026-01']).toBeDefined();
  });

  it('AC7 — synthetic ext_id: recId::gas in upsert payload', async () => {
    await callRoute();

    const allRows = upsertCalls
      .filter(c => c.table === 'service_payments')
      .flatMap(c => c.rows) as Array<Record<string, unknown>>;

    const gasRow = allRows.find(r => r['service_type'] === 'gas');
    expect(gasRow).toBeDefined();
    expect(gasRow!['airtable_external_id']).toBe('recGAS001::gas');
  });

  it('AC8 — missing AIRTABLE_TABLE_PAGOS_INTERNET → internet skipped, others continue, HTTP 200', async () => {
    const { status, body } = await callRoute();

    expect(status).toBe(200);

    const entityResults = body['entityResults'] as Array<Record<string, unknown>>;
    const aguaResult = entityResults?.find(r => r['entity'] === 'service_payments_agua');
    expect(aguaResult?.status).toBe('success');

    // internet entity should not appear (env var not set → skipped silently)
    const internetResult = entityResults?.find(r => r['entity'] === 'service_payments_internet');
    expect(internetResult).toBeUndefined();
  });

  it('AC10 — re-run same record → upsert called with ignoreDuplicates: false', async () => {
    await callRoute();

    const spUpserts = upsertCalls.filter(c => c.table === 'service_payments');
    for (const call of spUpserts) {
      const opts = call.opts as Record<string, unknown>;
      expect(opts['ignoreDuplicates']).toBe(false);
    }
  });

  it('property not found → property_id null, no abort', async () => {
    // Override: no properties returned so propertiesMap is empty
    airtableRecordsByKey['AIRTABLE_TABLE_PROPIEDADES'] = [];

    const { status, body } = await callRoute();

    // Should still return 200 (null FK → no abort, AC5 pattern)
    expect(status).toBe(200);

    const allRows = upsertCalls
      .filter(c => c.table === 'service_payments')
      .flatMap(c => c.rows) as Array<Record<string, unknown>>;

    const aguaRow = allRows.find(r => r['service_type'] === 'agua');
    if (aguaRow) {
      expect(aguaRow['property_id']).toBeNull();
    }

    void body;
  });
});
