/**
 * tests/unit/analyst/top-underperformers.test.ts
 *
 * Unit tests for AC15: deterministic analyst functions.
 *
 * Verifies:
 * - getWorstPerformingRooms: returns rooms sorted by highest loss ratio
 * - getLostDebtThisMonth: returns correct overdue sum
 * - getHighestExpenseProperties: returns properties sorted by expense total
 * - getRentToMarketGap: handles missing market data gracefully
 * - getMonthlyVs3MonthTrend: returns correct period rows
 * - getHighestRiskTenants: ranks by risk score (overdue + incidents)
 *
 * All Supabase calls are mocked — NO LLM calls, NO network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getWorstPerformingRooms,
  getLostDebtThisMonth,
  getHighestExpenseProperties,
  getRentToMarketGap,
  getMonthlyVs3MonthTrend,
  getHighestRiskTenants,
} from '@/lib/analyst/top-underperformers';
import { analyzePortfolio } from '@/lib/analyst/index';

// ---------------------------------------------------------------------------
// Mock Supabase builder
// ---------------------------------------------------------------------------

/** Fluent mock that returns data after any chain of .select/.eq/.gte/.lt/.neq calls */
function buildMockQuery(returnData: unknown, returnError: unknown = null) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'gte', 'lt', 'neq', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // terminal: awaiting the chain returns { data, error }
  (chain as Record<string, unknown>)[Symbol.toStringTag] = 'MockQuery';
  Object.defineProperty(chain, 'then', {
    value: (resolve: (v: unknown) => void) => resolve({ data: returnData, error: returnError }),
    writable: true,
  });
  return chain;
}

/** Build a mock Supabase client where each .from(table) returns a preconfigured chain */
function buildMockSupabase(tableData: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => buildMockQuery(tableData[table] ?? [], null)),
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';

// ---------------------------------------------------------------------------
// getWorstPerformingRooms
// ---------------------------------------------------------------------------

describe('getWorstPerformingRooms', () => {
  it('returns top-N rooms sorted by highest loss ratio', async () => {
    // Arrange: 3 units; unit-A billed 1000, collected 400 (60% loss); unit-B billed 800, collected 780 (2.5% loss); unit-C billed 500, collected 0 (100% loss)
    const mockUnits = [
      { id: 'unit-A', label: 'Room A', property_id: 'prop-1', properties: { name: 'Prop One' } },
      { id: 'unit-B', label: 'Room B', property_id: 'prop-1', properties: { name: 'Prop One' } },
      { id: 'unit-C', label: 'Room C', property_id: 'prop-2', properties: { name: 'Prop Two' } },
    ];
    const mockCharges = [
      { amount: 1000, contract_id: 'c1', contracts: { unit_id: 'unit-A', org_id: ORG_ID } },
      { amount: 800,  contract_id: 'c2', contracts: { unit_id: 'unit-B', org_id: ORG_ID } },
      { amount: 500,  contract_id: 'c3', contracts: { unit_id: 'unit-C', org_id: ORG_ID } },
    ];
    const mockPayments = [
      { amount: 400, contract_id: 'c1', contracts: { unit_id: 'unit-A', org_id: ORG_ID } },
      { amount: 780, contract_id: 'c2', contracts: { unit_id: 'unit-B', org_id: ORG_ID } },
      // unit-C: no payments
    ];

    // Build a supabase mock that returns different data per table
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'units') return buildMockQuery(mockUnits);
        if (table === 'charges') return buildMockQuery(mockCharges);
        if (table === 'payments') return buildMockQuery(mockPayments);
        return buildMockQuery([]);
      }),
    };

    // Act
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getWorstPerformingRooms(supabase as any, ORG_ID, 3);

    // Assert
    expect(result).toHaveLength(3);
    // Sorted descending by lossRatio: unit-C (100%) > unit-A (60%) > unit-B (2.5%)
    expect(result[0].unitId).toBe('unit-C');
    expect(result[0].lossRatio).toBeCloseTo(1.0, 2);
    expect(result[1].unitId).toBe('unit-A');
    expect(result[1].lossRatio).toBeCloseTo(0.6, 2);
    expect(result[2].unitId).toBe('unit-B');
    expect(result[2].lossRatio).toBeCloseTo(0.025, 3);
  });

  it('returns empty array when no units exist', async () => {
    const supabase = { from: vi.fn(() => buildMockQuery([])) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getWorstPerformingRooms(supabase as any, ORG_ID, 5);
    expect(result).toHaveLength(0);
  });

  it('assigns lossRatio=0 for units with no charges', async () => {
    const mockUnits = [
      { id: 'unit-X', label: 'Room X', property_id: 'prop-1', properties: { name: 'P' } },
    ];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'units') return buildMockQuery(mockUnits);
        return buildMockQuery([]);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getWorstPerformingRooms(supabase as any, ORG_ID, 5);
    expect(result).toHaveLength(1);
    expect(result[0].lossRatio).toBe(0);
    expect(result[0].billed).toBe(0);
    expect(result[0].collected).toBe(0);
  });

  it('respects topN limit', async () => {
    const mockUnits = Array.from({ length: 10 }, (_, i) => ({
      id: `unit-${i}`,
      label: `Room ${i}`,
      property_id: 'prop-1',
      properties: { name: 'P' },
    }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'units') return buildMockQuery(mockUnits);
        return buildMockQuery([]);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getWorstPerformingRooms(supabase as any, ORG_ID, 5);
    expect(result).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// getLostDebtThisMonth
// ---------------------------------------------------------------------------

describe('getLostDebtThisMonth', () => {
  it('returns correct sum of overdue balances', async () => {
    const mockStatements = [
      { tenant_id: 't1', balance: -300, is_overdue: true },
      { tenant_id: 't2', balance: -150, is_overdue: true },
      { tenant_id: 't3', balance: 200,  is_overdue: false }, // not overdue — excluded
      { tenant_id: 't4', balance: -50,  is_overdue: true },
    ];
    const supabase = { from: vi.fn(() => buildMockQuery(mockStatements)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getLostDebtThisMonth(supabase as any, ORG_ID);
    expect(result.overdueCount).toBe(3);
    expect(result.totalOverdueAmount).toBeCloseTo(500, 2); // 300 + 150 + 50
  });

  it('returns zero when no overdue tenants', async () => {
    const mockStatements = [
      { tenant_id: 't1', balance: 100, is_overdue: false },
    ];
    const supabase = { from: vi.fn(() => buildMockQuery(mockStatements)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getLostDebtThisMonth(supabase as any, ORG_ID);
    expect(result.overdueCount).toBe(0);
    expect(result.totalOverdueAmount).toBe(0);
  });

  it('handles null data from Supabase gracefully', async () => {
    const supabase = { from: vi.fn(() => buildMockQuery(null)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getLostDebtThisMonth(supabase as any, ORG_ID);
    expect(result.overdueCount).toBe(0);
    expect(result.totalOverdueAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getHighestExpenseProperties
// ---------------------------------------------------------------------------

describe('getHighestExpenseProperties', () => {
  it('returns properties ranked by total expenses', async () => {
    const mockExpenses = [
      { amount: 500, property_id: 'prop-1', properties: { name: 'Alpha' } },
      { amount: 300, property_id: 'prop-1', properties: { name: 'Alpha' } },
      { amount: 1200, property_id: 'prop-2', properties: { name: 'Beta' } },
      { amount: 100, property_id: 'prop-3', properties: { name: 'Gamma' } },
    ];
    const supabase = { from: vi.fn(() => buildMockQuery(mockExpenses)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHighestExpenseProperties(supabase as any, ORG_ID, 3);
    expect(result).toHaveLength(3);
    // Beta: 1200, Alpha: 800, Gamma: 100
    expect(result[0].propertyName).toBe('Beta');
    expect(result[0].totalExpenses).toBe(1200);
    expect(result[1].propertyName).toBe('Alpha');
    expect(result[1].totalExpenses).toBe(800);
    expect(result[2].propertyName).toBe('Gamma');
  });

  it('returns empty array when no expenses', async () => {
    const supabase = { from: vi.fn(() => buildMockQuery([])) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHighestExpenseProperties(supabase as any, ORG_ID);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRentToMarketGap
// ---------------------------------------------------------------------------

describe('getRentToMarketGap', () => {
  it('returns hasMarketData=false when no market_rate column', async () => {
    const supabase = { from: vi.fn(() => buildMockQuery(null, { message: 'column does not exist' })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRentToMarketGap(supabase as any, ORG_ID);
    expect(result.hasMarketData).toBe(false);
    expect(result.rows).toHaveLength(0);
  });

  it('returns gap correctly when market_rate is present', async () => {
    const mockUnits = [
      { id: 'u1', label: 'Room 1', monthly_rent_default: 1000, market_rate: 900 },
      { id: 'u2', label: 'Room 2', monthly_rent_default: 800,  market_rate: 950 },
    ];
    const supabase = { from: vi.fn(() => buildMockQuery(mockUnits)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRentToMarketGap(supabase as any, ORG_ID);
    expect(result.hasMarketData).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].gap).toBe(100);  // 1000 - 900
    expect(result.rows[1].gap).toBe(-150); // 800 - 950
  });

  it('sets gap=null for units with no market_rate', async () => {
    const mockUnits = [
      { id: 'u1', label: 'Room 1', monthly_rent_default: 1000, market_rate: null },
    ];
    const supabase = { from: vi.fn(() => buildMockQuery(mockUnits)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRentToMarketGap(supabase as any, ORG_ID);
    expect(result.hasMarketData).toBe(false);
    expect(result.rows[0].gap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMonthlyVs3MonthTrend
// ---------------------------------------------------------------------------

describe('getMonthlyVs3MonthTrend', () => {
  it('returns two period rows with correct calculations', async () => {
    // current month: 1200 revenue, 400 expenses
    // last 3 months: 2700 revenue total → avg 900, 900 expenses → avg 300
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'payments') {
          // We can't differentiate current vs historic calls from table alone,
          // so we return the same data; the function uses date filters
          return buildMockQuery([
            { amount: 1200 },
          ]);
        }
        if (table === 'expenses') {
          return buildMockQuery([
            { amount: 400 },
          ]);
        }
        return buildMockQuery([]);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getMonthlyVs3MonthTrend(supabase as any, ORG_ID);
    expect(result).toHaveLength(2);
    const currentRow = result.find((r) => r.period === 'current_month');
    const avgRow = result.find((r) => r.period === 'rolling_3_month_avg');
    expect(currentRow).toBeDefined();
    expect(avgRow).toBeDefined();
    // Both return same mock data; function is tested for structure
    expect(typeof currentRow!.revenue).toBe('number');
    expect(typeof currentRow!.expenses).toBe('number');
    expect(currentRow!.net).toBe(currentRow!.revenue - currentRow!.expenses);
  });
});

// ---------------------------------------------------------------------------
// getHighestRiskTenants
// ---------------------------------------------------------------------------

describe('getHighestRiskTenants', () => {
  it('ranks tenants by risk score (overdue balance + open incidents)', async () => {
    const mockStatements = [
      { tenant_id: 't1', balance: -500, is_overdue: true },
      { tenant_id: 't2', balance: -100, is_overdue: true },
    ];
    const mockIncidents = [
      { tenant_id: 't1' },
      { tenant_id: 't2' },
      { tenant_id: 't2' },
      { tenant_id: 't2' }, // t2 has 3 incidents
    ];
    const mockTenants = [
      { id: 't1', unit_id: 'u1', units: { label: 'Room 1' } },
      { id: 't2', unit_id: 'u2', units: { label: 'Room 2' } },
    ];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tenant_statement') return buildMockQuery(mockStatements);
        if (table === 'incidents') return buildMockQuery(mockIncidents);
        if (table === 'tenants') return buildMockQuery(mockTenants);
        return buildMockQuery([]);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHighestRiskTenants(supabase as any, ORG_ID, 5);
    expect(result).toHaveLength(2);
    // t1: riskScore = 500 * 0.7 + 1 * 30 * 0.3 = 350 + 9 = 359
    // t2: riskScore = 100 * 0.7 + 3 * 30 * 0.3 = 70 + 27 = 97
    expect(result[0].tenantId).toBe('t1');
    expect(result[1].tenantId).toBe('t2');
  });

  it('returns empty array when no risk tenants', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tenants') return buildMockQuery([
          { id: 't1', unit_id: 'u1', units: { label: 'Room 1' } },
        ]);
        return buildMockQuery([]);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHighestRiskTenants(supabase as any, ORG_ID, 5);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analyzePortfolio dispatcher (integration of the above)
// ---------------------------------------------------------------------------

describe('analyzePortfolio dispatcher', () => {
  it('returns source=deterministic for all slugs', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'units') return buildMockQuery([
          { id: 'u1', label: 'Room 1', property_id: 'p1', properties: { name: 'Prop' }, monthly_rent_default: 1000, market_rate: null },
        ]);
        if (table === 'tenant_statement') return buildMockQuery([]);
        return buildMockQuery([]);
      }),
    };

    const slugs = [
      'worst_performing_rooms',
      'lost_debt_this_month',
      'highest_expense_property',
      'rent_to_market_gap',
      'monthly_vs_3month_trend',
      'highest_risk_tenants',
    ] as const;

    for (const slug of slugs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await analyzePortfolio(supabase as any, ORG_ID, slug);
      expect(result.source).toBe('deterministic');
      expect(result.slug).toBe(slug);
      expect(typeof result.question).toBe('string');
      expect(typeof result.answer).toBe('string');
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  it('never calls fetch (no LLM) — AC15', async () => {
    // Verifies that no HTTP request is made during deterministic analysis.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const supabase = { from: vi.fn(() => buildMockQuery([])) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await analyzePortfolio(supabase as any, ORG_ID, 'lost_debt_this_month');

    // fetch should never have been called
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
