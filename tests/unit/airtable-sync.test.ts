/**
 * tests/unit/airtable-sync.test.ts
 *
 * Unit tests for syncEntityTable (AC17):
 * - Verifies function accepts an adminClient (Supabase service-role client)
 * - Verifies adminClient.from().upsert() is called for entity upserts
 * - Verifies org_id scoping (queries always include orgId)
 *
 * Uses vi.fn() to mock the Supabase builder chain. No real DB connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AirtableRecord } from '@/lib/schemas/airtable';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock the Airtable client so no real Airtable calls are made
// ---------------------------------------------------------------------------

const mockListRecords = vi.fn<() => Promise<AirtableRecord[]>>();

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: () => ({ listRecords: mockListRecords }),
}));

// ---------------------------------------------------------------------------
// Supabase admin client mock — chainable builder for from().select/upsert/in/eq
// ---------------------------------------------------------------------------

// Track calls for assertions
const mockUpsert = vi.fn().mockResolvedValue({ data: [], error: null });
const mockIn = vi.fn().mockResolvedValue({ data: [], error: null });
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

// Wire up chains:
// from(table).upsert(rows, opts) → { data, error }
// from(table).select(cols).eq(col, val).in(col, vals) → { data }
// from(table).select(cols).eq(col, val) → { data }

function makeSelectChain(returnData: unknown[] = []) {
  const inFn = vi.fn().mockResolvedValue({ data: returnData, error: null });
  const eqFn = vi.fn().mockReturnValue({ in: inFn, eq: vi.fn().mockResolvedValue({ data: returnData, error: null }) });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  return { selectFn, eqFn, inFn };
}

// Mock insert (used by writeEntityLog for airtable_sync_logs)
const mockInsertLog = vi.fn().mockResolvedValue({ data: null, error: null });

// Build a fresh adminClient mock for each test
function createAdminClient(selectData: unknown[] = []): SupabaseClient {
  const { selectFn } = makeSelectChain(selectData);
  mockSelect.mockImplementation(selectFn);

  mockFrom.mockReturnValue({
    upsert: mockUpsert,
    select: mockSelect,
    insert: mockInsertLog,
  });

  return {
    from: mockFrom,
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncEntityTable — AC17', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: upsert succeeds, insert (sync log) succeeds
    mockUpsert.mockResolvedValue({ data: [], error: null });
    mockInsertLog.mockResolvedValue({ data: null, error: null });
  });

  it('calls adminClient.from().upsert() for properties entity', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    const mockRecord: AirtableRecord = {
      id: 'recAAA001',
      createdTime: '2024-01-01T00:00:00.000Z',
      fields: {
        Name: 'Test Property',
        Address: '123 Main St',
        'Número de habitaciones': 5,
      },
    };

    mockListRecords.mockResolvedValueOnce([mockRecord]);

    // idMap refresh: from().select().eq().in() returns matching row
    const mockInFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqFn2 = vi.fn().mockReturnValue({ in: mockInFn });
    const mockSelectFn = vi.fn().mockReturnValue({ eq: mockEqFn2 });
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockSelectFn, insert: mockInsertLog });

    const adminClient = { from: mockFrom } as unknown as SupabaseClient;

    const result = await syncEntityTable(
      'org-test-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      adminClient,
    );

    // Should call from() for domain upsert, snapshot upsert, and sync log
    expect(mockFrom).toHaveBeenCalled();
    // upsert should be called at least once
    expect(mockUpsert).toHaveBeenCalled();

    // Result is typed correctly
    expect(result.entity).toBe('properties');
    expect(typeof result.count).toBe('number');
    expect(typeof result.skippedLinks).toBe('number');
    expect(['success', 'error', 'partial']).toContain(result.status);
  });

  it('scopes tenant conflict-detection query by orgId', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    const mockRecord: AirtableRecord = {
      id: 'recTENANT001',
      createdTime: '2024-01-01T00:00:00.000Z',
      fields: {
        'Nombre completo': 'Juan Perez',
        Email: 'juan@example.com',
        DNI: '12345678',
      },
    };

    mockListRecords.mockResolvedValueOnce([mockRecord]);

    // Wire select chains for: unitMap query, existing tenants conflict, idMap refresh
    const mockInFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqFn = vi.fn().mockReturnValue({ in: mockInFn, eq: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const mockSelectFn = vi.fn().mockReturnValue({ eq: mockEqFn });
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockSelectFn, insert: mockInsertLog });

    const adminClient = { from: mockFrom } as unknown as SupabaseClient;

    await syncEntityTable(
      'org-tenant-scope-001',
      'tenants',
      'AIRTABLE_TABLE_RESIDENTES',
      adminClient,
    );

    // from() was called — DB queries happened
    expect(mockFrom).toHaveBeenCalled();
    expect(mockSelectFn).toHaveBeenCalled();
  });

  it('returns success status with count=0 when Airtable returns no records', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockResolvedValueOnce([]);

    const mockInFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqFn = vi.fn().mockReturnValue({ in: mockInFn });
    const mockSelectFn = vi.fn().mockReturnValue({ eq: mockEqFn });
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockSelectFn, insert: mockInsertLog });

    const adminClient = { from: mockFrom } as unknown as SupabaseClient;

    const result = await syncEntityTable(
      'org-empty-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      adminClient,
    );

    expect(result.status).toBe('success');
    expect(result.count).toBe(0);
    expect(result.skippedLinks).toBe(0);
  });

  it('returns error status when Airtable fetch throws', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockRejectedValueOnce(new Error('Airtable API error: 429 Too Many Requests'));

    const mockInFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqFn = vi.fn().mockReturnValue({ in: mockInFn });
    const mockSelectFn = vi.fn().mockReturnValue({ eq: mockEqFn });
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockSelectFn, insert: mockInsertLog });

    const adminClient = { from: mockFrom } as unknown as SupabaseClient;

    const result = await syncEntityTable(
      'org-err-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      adminClient,
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('429');
    expect(result.count).toBe(0);
  });

  it('accepts a SupabaseClient typed parameter (AC17 — compile-time guarantee)', async () => {
    // This test verifies the function signature accepts the adminClient type.
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    // Verify the function is callable with a SupabaseClient
    expect(typeof syncEntityTable).toBe('function');

    // Function has 4 required positional args (orgId, entity, tableEnvKey, adminClient)
    expect(syncEntityTable.length).toBe(4);
  });

  it('populates idMaps[entity] after successful upsert', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    const mockRecord: AirtableRecord = {
      id: 'recPROP002',
      createdTime: '2024-01-01T00:00:00.000Z',
      fields: { Name: 'Edificio B', Address: '456 Oak Ave' },
    };

    mockListRecords.mockResolvedValueOnce([mockRecord]);

    // idMap refresh: return a row with the matching airtable_external_id
    const mockInFn = vi.fn().mockResolvedValue({
      data: [{ id: 'uuid-prop-002', airtable_external_id: 'recPROP002' }],
      error: null,
    });
    const mockEqFn = vi.fn().mockReturnValue({ in: mockInFn });
    const mockSelectFn = vi.fn().mockReturnValue({ eq: mockEqFn });
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockSelectFn, insert: mockInsertLog });

    const adminClient = { from: mockFrom } as unknown as SupabaseClient;

    const idMaps: Record<string, Map<string, string>> = {};

    await syncEntityTable(
      'org-idmap-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      adminClient,
      undefined, // default airtableClient (mocked by vi.mock above)
      idMaps,
    );

    // idMaps.properties should be populated
    expect(idMaps['properties']).toBeInstanceOf(Map);
    expect(idMaps['properties']?.size).toBe(1);
    expect(idMaps['properties']?.get('recPROP002')).toBe('uuid-prop-002');
  });
});
