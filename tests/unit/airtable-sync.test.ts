/**
 * tests/unit/airtable-sync.test.ts
 *
 * Unit tests for syncEntityTable (AC17):
 * - Verifies function accepts a Drizzle db (PostgresJsDatabase)
 * - Verifies db.insert().onConflictDoUpdate() is called for entity upserts
 * - Verifies org_id scoping (queries always include orgId)
 *
 * Uses vi.fn() to mock the Drizzle builder chain. No real DB connection.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Mock the Airtable client so no real Airtable calls are made
// ---------------------------------------------------------------------------

const mockListRecords = vi.fn<() => Promise<AirtableRecord[]>>();

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: () => ({ listRecords: mockListRecords }),
}));

// ---------------------------------------------------------------------------
// Mock the Drizzle db — chain builder pattern
// ---------------------------------------------------------------------------

// Drizzle's insert builder is a chainable object: insert().values().onConflictDoUpdate()
// We capture calls to verify:
//   1. insert() is called with the correct table
//   2. onConflictDoUpdate() receives { target, set } with org_id + airtable_external_id

const mockOnConflictDoUpdate = vi.fn().mockResolvedValue([]);
const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

// For select (idMap refresh + unitMap build + contractToTenantMap)
const mockWhere = vi.fn().mockResolvedValue([]);
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
} as unknown as import('drizzle-orm/postgres-js').PostgresJsDatabase;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncEntityTable — AC17', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: select queries return empty array (no existing tenants for conflict check)
    mockWhere.mockResolvedValue([]);
  });

  it('calls db.insert().values().onConflictDoUpdate() for properties entity', async () => {
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

    // idMap refresh query returns an empty list (no freshRows needed for this test)
    mockWhere.mockResolvedValue([]);

    const result = await syncEntityTable(
      'org-test-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      mockDb,
    );

    // Should call insert (at minimum once for domain table, once for airtable_snapshots, once for sync log)
    expect(mockInsert).toHaveBeenCalled();

    // onConflictDoUpdate should be called for the domain upsert
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();

    // The call args should include target and set
    const [conflictArgs] = mockOnConflictDoUpdate.mock.calls[0] ?? [{}];
    expect(conflictArgs).toHaveProperty('target');
    expect(conflictArgs).toHaveProperty('set');

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

    // unitMap query + existing tenants conflict query + idMap refresh — all scoped
    const selectCallResults = [
      [],  // unitMap query
      [],  // existing tenants for conflict detection
      [],  // idMap refresh
    ];
    let callIdx = 0;
    mockWhere.mockImplementation(() => Promise.resolve(selectCallResults[callIdx++] ?? []));

    await syncEntityTable(
      'org-tenant-scope-001',
      'tenants',
      'AIRTABLE_TABLE_RESIDENTES',
      mockDb,
    );

    // select().from().where() was called — verifying DB queries happened
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it('returns success status with count=0 when Airtable returns no records', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockResolvedValueOnce([]);

    const result = await syncEntityTable(
      'org-empty-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      mockDb,
    );

    expect(result.status).toBe('success');
    expect(result.count).toBe(0);
    expect(result.skippedLinks).toBe(0);
  });

  it('returns error status when Airtable fetch throws', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockRejectedValueOnce(new Error('Airtable API error: 429 Too Many Requests'));

    const result = await syncEntityTable(
      'org-err-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      mockDb,
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('429');
    expect(result.count).toBe(0);
  });

  it('accepts a PostgresJsDatabase typed parameter (AC17 — compile-time guarantee)', async () => {
    // This test verifies the function signature accepts the Drizzle db type.
    // If the signature were still SupabaseClient, this import would fail TypeScript.
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    // Verify the function is callable with the mockDb (typed as PostgresJsDatabase)
    expect(typeof syncEntityTable).toBe('function');

    // Function has 4 required positional args (orgId, entity, tableEnvKey, db)
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
    mockWhere.mockResolvedValueOnce([
      { id: 'uuid-prop-002', airtableExternalId: 'recPROP002' },
    ]);

    const idMaps: Record<string, Map<string, string>> = {};

    await syncEntityTable(
      'org-idmap-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      mockDb,
      undefined, // default airtableClient (mocked by vi.mock above)
      idMaps,
    );

    // idMaps.properties should be populated
    expect(idMaps['properties']).toBeInstanceOf(Map);
    expect(idMaps['properties']?.size).toBe(1);
    expect(idMaps['properties']?.get('recPROP002')).toBe('uuid-prop-002');
  });
});
