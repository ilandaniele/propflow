/**
 * tests/unit/dashboard-health.test.ts
 *
 * AC3: Unit tests for checkEntityHealth in src/lib/dashboard/health.ts
 *
 * Migrated from Supabase mock to Drizzle mock (W10).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkEntityHealth } from '@/lib/dashboard/health';

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// Each entity call is db.select({n: count()}).from(table).where(eq(table.orgId, orgId))
// ---------------------------------------------------------------------------

// Per-table outcome control
type TableOutcome = { count: number; throws?: boolean };
const tableOutcomes: Record<string, TableOutcome> = {};

// Track orgId values passed in where conditions (we capture via getTableName)
const capturedOrgIds: Record<string, string[]> = {};

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return 'unknown';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find((s) => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : 'unknown';
  }

  // Extract orgId string value from a Drizzle eq() condition
  function extractOrgId(cond: unknown): string | null {
    if (!cond || typeof cond !== 'object') return null;
    const obj = cond as Record<string, unknown>;
    if (typeof obj['value'] === 'string') return obj['value'];
    if (obj['right']) return extractOrgId(obj['right']);
    if (Array.isArray(obj['queryChunks'])) {
      for (const c of obj['queryChunks']) {
        const v = extractOrgId(c);
        if (v) return v;
      }
    }
    return null;
  }

  return {
    db: {
      select: vi.fn(() => {
        let tableName = 'unknown';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn((cond?: unknown) => {
            const orgId = extractOrgId(cond);
            if (orgId) {
              capturedOrgIds[tableName] = capturedOrgIds[tableName] ?? [];
              capturedOrgIds[tableName].push(orgId);
            }
            // Return a thenable so the function can await the chain
            const outcome = tableOutcomes[tableName] ?? { count: 0 };
            if (outcome.throws) {
              return Promise.reject(new Error(`DB exploded for ${tableName}`));
            }
            return Promise.resolve([{ n: outcome.count }]);
          }),
        };
        return chain;
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableOutcomes)) delete tableOutcomes[k];
  for (const k of Object.keys(capturedOrgIds)) delete capturedOrgIds[k];
});

describe('checkEntityHealth — happy path', () => {
  it('returns correct counts for all entities when all queries succeed', async () => {
    tableOutcomes['tenants']    = { count: 5 };
    tableOutcomes['properties'] = { count: 3 };
    tableOutcomes['payments']   = { count: 12 };
    tableOutcomes['contracts']  = { count: 2 };

    const results = await checkEntityHealth(ORG_ID);

    expect(results).toHaveLength(4);

    const tenantsRow = results.find((r) => r.entity === 'tenants');
    expect(tenantsRow?.count).toBe(5);
    expect(tenantsRow?.error).toBeNull();

    const paymentsRow = results.find((r) => r.entity === 'payments');
    expect(paymentsRow?.count).toBe(12);
    expect(paymentsRow?.error).toBeNull();
  });
});

describe('checkEntityHealth — per-entity isolation (supabase error)', () => {
  it('one entity returning a supabase error does not affect others', async () => {
    // tenants throws → simulates DB error
    tableOutcomes['tenants']    = { count: 0, throws: true };
    tableOutcomes['properties'] = { count: 7 };
    tableOutcomes['payments']   = { count: 4 };
    tableOutcomes['contracts']  = { count: 1 };

    const results = await checkEntityHealth(ORG_ID);

    expect(results).toHaveLength(4);

    // Errored entity: zero count, generic Spanish error
    const tenantsRow = results.find((r) => r.entity === 'tenants');
    expect(tenantsRow?.count).toBe(0);
    expect(tenantsRow?.error).not.toBeNull();
    expect(tenantsRow?.error).not.toContain('DB exploded');
    expect(tenantsRow?.error).toContain('Inquilinos');

    // Others unaffected
    const propertiesRow = results.find((r) => r.entity === 'properties');
    expect(propertiesRow?.count).toBe(7);
    expect(propertiesRow?.error).toBeNull();

    const paymentsRow = results.find((r) => r.entity === 'payments');
    expect(paymentsRow?.count).toBe(4);
    expect(paymentsRow?.error).toBeNull();
  });
});

describe('checkEntityHealth — per-entity isolation (thrown exception)', () => {
  it('one entity throwing does not block other entities', async () => {
    tableOutcomes['tenants']    = { count: 3 };
    tableOutcomes['properties'] = { count: 0, throws: true };
    tableOutcomes['payments']   = { count: 10 };
    tableOutcomes['contracts']  = { count: 2 };

    const results = await checkEntityHealth(ORG_ID);

    expect(results).toHaveLength(4);

    const propertiesRow = results.find((r) => r.entity === 'properties');
    expect(propertiesRow?.count).toBe(0);
    expect(propertiesRow?.error).not.toBeNull();
    expect(propertiesRow?.error).not.toContain('DB exploded');
    expect(propertiesRow?.error).toContain('Propiedades');

    const tenantsRow = results.find((r) => r.entity === 'tenants');
    expect(tenantsRow?.count).toBe(3);
    expect(tenantsRow?.error).toBeNull();

    const paymentsRow = results.find((r) => r.entity === 'payments');
    expect(paymentsRow?.count).toBe(10);
    expect(paymentsRow?.error).toBeNull();
  });
});

describe('checkEntityHealth — generic error strings (AC3 security)', () => {
  it('error field contains Spanish generic message, not raw DB error message', async () => {
    tableOutcomes['tenants']    = { count: 0, throws: true };
    tableOutcomes['properties'] = { count: 1 };
    tableOutcomes['payments']   = { count: 1 };
    tableOutcomes['contracts']  = { count: 1 };

    const results = await checkEntityHealth(ORG_ID);
    const tenantsRow = results.find((r) => r.entity === 'tenants');

    expect(tenantsRow?.error).toBeDefined();
    expect(tenantsRow?.error).not.toContain('42501');
    expect(tenantsRow?.error).toMatch(/No se pudo verificar/);
  });
});

describe('checkEntityHealth — org_id scope', () => {
  it('every query includes .eq("org_id", orgId)', async () => {
    tableOutcomes['tenants']    = { count: 1 };
    tableOutcomes['properties'] = { count: 1 };
    tableOutcomes['payments']   = { count: 1 };
    tableOutcomes['contracts']  = { count: 1 };

    await checkEntityHealth(ORG_ID);

    for (const table of ['tenants', 'properties', 'payments', 'contracts']) {
      const captured = capturedOrgIds[table] ?? [];
      expect(captured).toContain(ORG_ID);
    }
  });

  it('uses the orgId argument — not a hardcoded value', async () => {
    const DIFFERENT_ORG = 'org-different-999';
    tableOutcomes['tenants']    = { count: 2 };
    tableOutcomes['properties'] = { count: 2 };
    tableOutcomes['payments']   = { count: 2 };
    tableOutcomes['contracts']  = { count: 2 };

    await checkEntityHealth(DIFFERENT_ORG);

    for (const table of ['tenants', 'properties', 'payments', 'contracts']) {
      const captured = capturedOrgIds[table] ?? [];
      expect(captured).toContain(DIFFERENT_ORG);
      expect(captured).not.toContain(ORG_ID);
    }
  });
});
