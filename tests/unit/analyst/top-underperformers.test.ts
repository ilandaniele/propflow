/**
 * tests/unit/analyst/top-underperformers.test.ts
 *
 * Unit tests for AC15: deterministic analyst functions.
 * Migrated from Supabase mock to Drizzle mock (W10).
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
// Fixture data — mutated per test
// ---------------------------------------------------------------------------

interface UnitFixture { id: string; label: string; propertyId?: string; propertyName?: string; monthlyRentDefault?: number; marketRate?: number | null }
interface TenantFixture { id: string; unitId: string | null; unitLabel?: string | null }
interface ChargeFixture { contractId: string; amount: number }
interface PaymentFixture { contractId: string; amount: number }
interface ContractFixture { id: string; unitId: string }
interface ExpenseFixture { amount: number; propertyId: string; propertyName: string }
interface IncidentFixture { tenantId: string | null }

const fixture: {
  units: UnitFixture[];
  tenants: TenantFixture[];
  charges: ChargeFixture[];
  payments: PaymentFixture[];
  contracts: ContractFixture[];
  expenses: ExpenseFixture[];
  incidents: IncidentFixture[];
  executeResults: unknown[];
} = {
  units: [], tenants: [], charges: [], payments: [],
  contracts: [], expenses: [], incidents: [], executeResults: [],
};

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
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          // Awaitable chain (used by Promise.all)
          then: (resolve: (v: unknown[]) => void) => {
            switch (tableName) {
              case 'units':     return resolve(fixture.units);
              case 'tenants':   return resolve(fixture.tenants);
              case 'charges':   return resolve(fixture.charges);
              case 'payments':  return resolve(fixture.payments);
              case 'contracts': return resolve(fixture.contracts);
              case 'expenses':  return resolve(fixture.expenses);
              case 'incidents': return resolve(fixture.incidents);
              default:          return resolve([]);
            }
          },
        };
        return chain;
      }),

      execute: vi.fn(async () => fixture.executeResults),
    },
  };
});

const ORG_ID = 'org-test-001';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.units = [];
  fixture.tenants = [];
  fixture.charges = [];
  fixture.payments = [];
  fixture.contracts = [];
  fixture.expenses = [];
  fixture.incidents = [];
  fixture.executeResults = [];
});

// ---------------------------------------------------------------------------
// getWorstPerformingRooms
// ---------------------------------------------------------------------------

describe('getWorstPerformingRooms', () => {
  it('returns top-N rooms sorted by highest loss ratio', async () => {
    fixture.units = [
      { id: 'unit-A', label: 'Room A', propertyId: 'prop-1', propertyName: 'Prop One' },
      { id: 'unit-B', label: 'Room B', propertyId: 'prop-1', propertyName: 'Prop One' },
      { id: 'unit-C', label: 'Room C', propertyId: 'prop-2', propertyName: 'Prop Two' },
    ];
    fixture.contracts = [
      { id: 'c1', unitId: 'unit-A' },
      { id: 'c2', unitId: 'unit-B' },
      { id: 'c3', unitId: 'unit-C' },
    ];
    fixture.charges = [
      { contractId: 'c1', amount: 1000 },
      { contractId: 'c2', amount: 800 },
      { contractId: 'c3', amount: 500 },
    ];
    fixture.payments = [
      { contractId: 'c1', amount: 400 },
      { contractId: 'c2', amount: 780 },
      // unit-C: no payments
    ];

    const result = await getWorstPerformingRooms(ORG_ID, 3);

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
    fixture.units = [];
    const result = await getWorstPerformingRooms(ORG_ID, 5);
    expect(result).toHaveLength(0);
  });

  it('assigns lossRatio=0 for units with no charges', async () => {
    fixture.units = [{ id: 'unit-X', label: 'Room X', propertyId: 'prop-1', propertyName: 'P' }];
    fixture.contracts = [{ id: 'cx', unitId: 'unit-X' }];
    fixture.charges = [];
    fixture.payments = [];

    const result = await getWorstPerformingRooms(ORG_ID, 5);
    expect(result).toHaveLength(1);
    expect(result[0].lossRatio).toBe(0);
    expect(result[0].billed).toBe(0);
    expect(result[0].collected).toBe(0);
  });

  it('respects topN limit', async () => {
    fixture.units = Array.from({ length: 10 }, (_, i) => ({
      id: `unit-${i}`, label: `Room ${i}`, propertyId: 'prop-1', propertyName: 'P',
    }));
    fixture.contracts = fixture.units.map((u, i) => ({ id: `c${i}`, unitId: u.id }));
    fixture.charges = [];
    fixture.payments = [];

    const result = await getWorstPerformingRooms(ORG_ID, 5);
    expect(result).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// getLostDebtThisMonth — uses db.execute() for raw SQL
// ---------------------------------------------------------------------------

describe('getLostDebtThisMonth', () => {
  it('returns correct sum of overdue balances', async () => {
    fixture.executeResults = [
      { tenant_id: 't1', balance: -300, is_overdue: true },
      { tenant_id: 't2', balance: -150, is_overdue: true },
      { tenant_id: 't3', balance: 200,  is_overdue: false },
      { tenant_id: 't4', balance: -50,  is_overdue: true },
    ];

    const result = await getLostDebtThisMonth(ORG_ID);
    expect(result.overdueCount).toBe(3);
    expect(result.totalOverdueAmount).toBeCloseTo(500, 2);
  });

  it('returns zero when no overdue tenants', async () => {
    fixture.executeResults = [
      { tenant_id: 't1', balance: 100, is_overdue: false },
    ];

    const result = await getLostDebtThisMonth(ORG_ID);
    expect(result.overdueCount).toBe(0);
    expect(result.totalOverdueAmount).toBe(0);
  });

  it('handles null data from Supabase gracefully', async () => {
    fixture.executeResults = [];

    const result = await getLostDebtThisMonth(ORG_ID);
    expect(result.overdueCount).toBe(0);
    expect(result.totalOverdueAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getHighestExpenseProperties
// ---------------------------------------------------------------------------

describe('getHighestExpenseProperties', () => {
  it('returns properties ranked by total expenses', async () => {
    fixture.expenses = [
      { amount: 500,  propertyId: 'prop-1', propertyName: 'Alpha' },
      { amount: 300,  propertyId: 'prop-1', propertyName: 'Alpha' },
      { amount: 1200, propertyId: 'prop-2', propertyName: 'Beta' },
      { amount: 100,  propertyId: 'prop-3', propertyName: 'Gamma' },
    ];

    const result = await getHighestExpenseProperties(ORG_ID, 3);
    expect(result).toHaveLength(3);
    // Beta: 1200, Alpha: 800, Gamma: 100
    expect(result[0].propertyName).toBe('Beta');
    expect(result[0].totalExpenses).toBe(1200);
    expect(result[1].propertyName).toBe('Alpha');
    expect(result[1].totalExpenses).toBe(800);
    expect(result[2].propertyName).toBe('Gamma');
  });

  it('returns empty array when no expenses', async () => {
    fixture.expenses = [];
    const result = await getHighestExpenseProperties(ORG_ID);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRentToMarketGap — uses db.execute() for raw SQL
// ---------------------------------------------------------------------------

describe('getRentToMarketGap', () => {
  it('returns gap correctly when market_rate is present', async () => {
    fixture.executeResults = [
      { id: 'u1', label: 'Room 1', monthly_rent_default: 1000, market_rate: 900 },
      { id: 'u2', label: 'Room 2', monthly_rent_default: 800,  market_rate: 950 },
    ];

    const result = await getRentToMarketGap(ORG_ID);
    expect(result.hasMarketData).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].gap).toBe(100);   // 1000 - 900
    expect(result.rows[1].gap).toBe(-150);  // 800 - 950
  });

  it('sets gap=null for units with no market_rate', async () => {
    fixture.executeResults = [
      { id: 'u1', label: 'Room 1', monthly_rent_default: 1000, market_rate: null },
    ];

    const result = await getRentToMarketGap(ORG_ID);
    expect(result.hasMarketData).toBe(false);
    expect(result.rows[0].gap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMonthlyVs3MonthTrend
// ---------------------------------------------------------------------------

describe('getMonthlyVs3MonthTrend', () => {
  it('returns two period rows with correct calculations', async () => {
    // All 4 parallel select calls return the same mock data
    fixture.payments = [{ contractId: 'c1', amount: 1200 }];
    fixture.expenses = [{ amount: 400, propertyId: 'p1', propertyName: 'P' }];

    const result = await getMonthlyVs3MonthTrend(ORG_ID);
    expect(result).toHaveLength(2);
    const currentRow = result.find((r) => r.period === 'current_month');
    const avgRow = result.find((r) => r.period === 'rolling_3_month_avg');
    expect(currentRow).toBeDefined();
    expect(avgRow).toBeDefined();
    expect(typeof currentRow!.revenue).toBe('number');
    expect(typeof currentRow!.expenses).toBe('number');
    expect(currentRow!.net).toBe(currentRow!.revenue - currentRow!.expenses);
  });
});

// ---------------------------------------------------------------------------
// getHighestRiskTenants — uses db.execute() for statement + db.select() for incidents/tenants
// ---------------------------------------------------------------------------

describe('getHighestRiskTenants', () => {
  it('ranks tenants by risk score (overdue balance + open incidents)', async () => {
    fixture.executeResults = [
      { tenant_id: 't1', balance: -500, is_overdue: true },
      { tenant_id: 't2', balance: -100, is_overdue: true },
    ];
    fixture.incidents = [
      { tenantId: 't1' },
      { tenantId: 't2' },
      { tenantId: 't2' },
      { tenantId: 't2' }, // t2 has 3 incidents
    ];
    fixture.tenants = [
      { id: 't1', unitId: 'u1', unitLabel: 'Room 1' },
      { id: 't2', unitId: 'u2', unitLabel: 'Room 2' },
    ];

    const result = await getHighestRiskTenants(ORG_ID, 5);
    expect(result).toHaveLength(2);
    // t1: overdueBalance=500 → higher riskScore
    expect(result[0].tenantId).toBe('t1');
    expect(result[1].tenantId).toBe('t2');
  });

  it('returns empty array when no risk tenants', async () => {
    fixture.executeResults = [];  // no overdue statements
    fixture.incidents = [];
    fixture.tenants = [
      { id: 't1', unitId: 'u1', unitLabel: 'Room 1' },
    ];

    const result = await getHighestRiskTenants(ORG_ID, 5);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analyzePortfolio dispatcher
// ---------------------------------------------------------------------------

describe('analyzePortfolio dispatcher', () => {
  it('returns source=deterministic for all slugs', async () => {
    fixture.units = [{ id: 'u1', label: 'Room 1', propertyId: 'p1', propertyName: 'Prop', monthlyRentDefault: 1000, marketRate: null }];
    fixture.contracts = [{ id: 'c1', unitId: 'u1' }];
    fixture.executeResults = [];

    const slugs = [
      'worst_performing_rooms',
      'lost_debt_this_month',
      'highest_expense_property',
      'rent_to_market_gap',
      'monthly_vs_3month_trend',
      'highest_risk_tenants',
    ] as const;

    for (const slug of slugs) {
      const result = await analyzePortfolio(ORG_ID, slug);
      expect(result.source).toBe('deterministic');
      expect(result.slug).toBe(slug);
      expect(typeof result.question).toBe('string');
      expect(typeof result.answer).toBe('string');
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  it('never calls fetch (no LLM) — AC15', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fixture.executeResults = [];

    await analyzePortfolio(ORG_ID, 'lost_debt_this_month');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
