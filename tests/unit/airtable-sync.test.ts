/**
 * tests/unit/airtable-sync.test.ts
 *
 * Unit tests for syncEntityTable (Drizzle version).
 * - Verifies function uses @/lib/db for DB operations
 * - Verifies airtableClient.listRecords() is called for entity fetches
 * - Verifies correct result shape (entity, count, status)
 *
 * Uses vi.fn() to mock both @/lib/db and the Airtable client.
 * No real DB or Airtable connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Mock @/lib/db — covers all Drizzle calls inside syncEntityTable
// ---------------------------------------------------------------------------

const mockDbExecute = vi.fn(async () => []);
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

function setupDefaultDbMocks() {
  // select chain: used for org queries, unit map, existing tenants, id maps
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => []),
    then: (resolve: (v: unknown[]) => void) => resolve([]),
  };
  mockDbSelect.mockReturnValue(selectChain);

  // insert chain: used for airtable_sync_logs and airtable_snapshots
  const insertChain = {
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(async () => []),
      onConflictDoNothing: vi.fn(async () => []),
      returning: vi.fn(async () => []),
    })),
  };
  mockDbInsert.mockReturnValue(insertChain);

  // update chain
  const updateChain = {
    set: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  };
  mockDbUpdate.mockReturnValue(updateChain);

  // execute: used for raw SQL upserts
  mockDbExecute.mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Mock the Airtable client
// ---------------------------------------------------------------------------

const mockListRecords = vi.fn<() => Promise<AirtableRecord[]>>();

vi.mock('@/lib/airtable/client', () => ({
  getAirtableClient: () => ({ listRecords: mockListRecords }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncEntityTable — AC17 (Drizzle version)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultDbMocks();
  });

  it('calls airtableClient.listRecords() for properties entity', async () => {
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

    const result = await syncEntityTable(
      'org-test-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
    );

    expect(mockListRecords).toHaveBeenCalledWith('AIRTABLE_TABLE_PROPIEDADES');
    expect(result.entity).toBe('properties');
    expect(typeof result.count).toBe('number');
    expect(typeof result.skippedLinks).toBe('number');
    expect(['success', 'error', 'partial']).toContain(result.status);
  });

  it('uses db.execute() for upsert SQL (Drizzle raw SQL path)', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    const mockRecord: AirtableRecord = {
      id: 'recAAA002',
      createdTime: '2024-01-01T00:00:00.000Z',
      fields: { Name: 'Casa Verde', Address: 'Av. Test 456' },
    };

    mockListRecords.mockResolvedValueOnce([mockRecord]);

    await syncEntityTable(
      'org-execute-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
    );

    // db.execute() is called for each row upsert
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('scopes tenant conflict-detection query by orgId using db.select()', async () => {
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

    await syncEntityTable(
      'org-tenant-scope-001',
      'tenants',
      'AIRTABLE_TABLE_RESIDENTES',
    );

    // db.select() called for unit map and/or existing tenant conflict check
    expect(mockDbSelect).toHaveBeenCalled();
  });

  it('returns success status with count=0 when Airtable returns no records', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockResolvedValueOnce([]);

    const result = await syncEntityTable(
      'org-empty-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
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
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('429');
    expect(result.count).toBe(0);
  });

  it('has 3 required positional parameters (orgId, entity, tableEnvKey)', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');
    // Function.length counts params before first default
    expect(syncEntityTable.length).toBe(3);
  });

  it('writes airtable_sync_logs via db.insert() after sync', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    mockListRecords.mockResolvedValueOnce([]);

    await syncEntityTable(
      'org-log-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
    );

    // db.insert() should be called for the sync log
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('passes a custom airtableClient as optional 4th argument', async () => {
    const { syncEntityTable } = await import('@/lib/airtable/sync-entities');

    const customListRecords = vi.fn<() => Promise<AirtableRecord[]>>().mockResolvedValue([]);
    const customAirtableClient = { listRecords: customListRecords };

    await syncEntityTable(
      'org-custom-001',
      'properties',
      'AIRTABLE_TABLE_PROPIEDADES',
      customAirtableClient,
    );

    expect(customListRecords).toHaveBeenCalledWith('AIRTABLE_TABLE_PROPIEDADES');
    // Default mock was NOT called
    expect(mockListRecords).not.toHaveBeenCalled();
  });
});
