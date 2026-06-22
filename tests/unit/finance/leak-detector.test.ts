/**
 * tests/unit/finance/leak-detector.test.ts
 *
 * Unit tests for detectHiddenLeaks (AC14).
 * Migrated from Supabase mock to Drizzle mock (W10).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectHiddenLeaks } from '@/lib/finance/leak-detector';

// ---------------------------------------------------------------------------
// Fixture data container — mutated per test
// ---------------------------------------------------------------------------

interface UnitRow { id: string; label: string }
interface TenantRow { id: string; unitId: string | null }
interface ChargeRow { tenantId: string; amount: number }
interface PaymentRow { contractId: string; amount: number }
interface ContractRow { id: string; unitId: string }

const fixture: {
  units: UnitRow[];
  tenants: TenantRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
  contracts: ContractRow[];
} = { units: [], tenants: [], charges: [], payments: [], contracts: [] };

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return 'unknown';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find((s) => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : 'unknown';
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
          where: vi.fn(() => chain),
          // Some queries await the chain directly (no .limit())
          then: (resolve: (v: unknown[]) => void) => {
            if (tableName === 'units')     return resolve(fixture.units);
            if (tableName === 'tenants')   return resolve(fixture.tenants);
            if (tableName === 'charges')   return resolve(fixture.charges);
            if (tableName === 'payments')  return resolve(fixture.payments);
            if (tableName === 'contracts') return resolve(fixture.contracts);
            return resolve([]);
          },
          limit: vi.fn(async () => {
            if (tableName === 'units')     return fixture.units;
            if (tableName === 'tenants')   return fixture.tenants;
            if (tableName === 'charges')   return fixture.charges;
            if (tableName === 'payments')  return fixture.payments;
            if (tableName === 'contracts') return fixture.contracts;
            return [];
          }),
        };
        return chain;
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function setFixture(opts: {
  units?: UnitRow[];
  tenants?: TenantRow[];
  charges?: ChargeRow[];
  payments?: PaymentRow[];
  contracts?: ContractRow[];
}) {
  fixture.units     = opts.units     ?? [];
  fixture.tenants   = opts.tenants   ?? [];
  fixture.charges   = opts.charges   ?? [];
  fixture.payments  = opts.payments  ?? [];
  fixture.contracts = opts.contracts ?? [];
}

const ORG_ID = 'org-test-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectHiddenLeaks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFixture({});
  });

  it('returns empty array when there are no units', async () => {
    setFixture({ units: [] });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toEqual([]);
  });

  it('returns empty array when gap is exactly 15% (not > 15%)', async () => {
    // billed=100, collected=85 → gap=15 → gapRatio=0.15 → NOT > 0.15 → no finding
    setFixture({
      units:     [{ id: 'u1', label: 'Room 1' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 85 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(0);
  });

  it('returns finding when gap is > 15%', async () => {
    // billed=100, collected=80 → gap=20 → gapRatio=0.20 → > 0.15 → finding
    setFixture({
      units:     [{ id: 'u1', label: 'Room 1A' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 80 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(1);
    expect(result[0].unitId).toBe('u1');
    expect(result[0].unitLabel).toBe('Room 1A');
    expect(result[0].billedTotal).toBe(100);
    expect(result[0].collectedTotal).toBe(80);
    expect(result[0].amount).toBe(20);
    expect(result[0].gapRatio).toBeCloseTo(0.2, 2);
    expect(result[0].severity).toBe('medium');
  });

  it('classifies severity as high when gap > 35%', async () => {
    // billed=100, collected=60 → gap=40 → gapRatio=0.40 → high
    setFixture({
      units:     [{ id: 'u1', label: 'Room 2B' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 60 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('high');
  });

  it('returns empty when gap is zero (collected === billed)', async () => {
    setFixture({
      units:     [{ id: 'u1', label: 'Room 1' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 500 }],
      payments:  [{ contractId: 'c1', amount: 500 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(0);
  });

  it('returns empty when nothing is billed (billed=0)', async () => {
    setFixture({
      units:   [{ id: 'u1', label: 'Room 1' }],
      tenants: [{ id: 't1', unitId: 'u1' }],
      charges: [],
      payments: [],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(0);
  });

  it('returns empty when collected > billed (overpayment, gap < 0)', async () => {
    setFixture({
      units:     [{ id: 'u1', label: 'Room 1' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 120 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(0);
  });

  it('returns only units with gap > 15% when multiple units are present', async () => {
    setFixture({
      units:     [{ id: 'u1', label: 'Room A' }, { id: 'u2', label: 'Room B' }, { id: 'u3', label: 'Room C' }],
      tenants:   [{ id: 't1', unitId: 'u1' }, { id: 't2', unitId: 'u2' }, { id: 't3', unitId: 'u3' }],
      contracts: [{ id: 'c1', unitId: 'u1' }, { id: 'c2', unitId: 'u2' }, { id: 'c3', unitId: 'u3' }],
      charges:   [{ tenantId: 't1', amount: 100 }, { tenantId: 't2', amount: 100 }, { tenantId: 't3', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 80 }, { contractId: 'c2', amount: 90 }, { contractId: 'c3', amount: 50 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(2);
    // Sorted by gapRatio descending: u3 (0.5) before u1 (0.2)
    expect(result[0].unitId).toBe('u3');
    expect(result[0].severity).toBe('high');
    expect(result[1].unitId).toBe('u1');
    expect(result[1].severity).toBe('medium');
    expect(result.find((f) => f.unitId === 'u2')).toBeUndefined();
  });

  it('aggregates multiple charges for the same unit', async () => {
    setFixture({
      units:     [{ id: 'u1', label: 'Room 1' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 100 }, { tenantId: 't1', amount: 100 }],
      payments:  [{ contractId: 'c1', amount: 150 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result).toHaveLength(1);
    expect(result[0].billedTotal).toBe(200);
    expect(result[0].collectedTotal).toBe(150);
    expect(result[0].amount).toBe(50);
  });

  it('description string contains unit label, amounts, and percentage', async () => {
    setFixture({
      units:     [{ id: 'u1', label: 'Suite 3' }],
      tenants:   [{ id: 't1', unitId: 'u1' }],
      contracts: [{ id: 'c1', unitId: 'u1' }],
      charges:   [{ tenantId: 't1', amount: 200 }],
      payments:  [{ contractId: 'c1', amount: 120 }],
    });
    const result = await detectHiddenLeaks(ORG_ID);
    expect(result[0].description).toContain('Suite 3');
    expect(result[0].description).toContain('200.00');
    expect(result[0].description).toContain('120.00');
    expect(result[0].description).toContain('40%');
  });
});
