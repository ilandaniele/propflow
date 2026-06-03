/**
 * tests/integration/finance-rooms.test.ts
 *
 * Integration tests for room profitability (AC23):
 *   - computeRoomProfitability applies the allowlist-validated sort (no SQL string concat)
 *   - Pagination caps at max 100 rows per page
 *   - Each sort column produces the expected descending order
 *   - Sort with invalid column falls back (the page validates before calling the function)
 *   - ROOM_SORT_COLUMNS allowlist contains expected values
 *   - Page parameter slices correctly
 */

import { describe, it, expect } from 'vitest';
import {
  computeRoomProfitability,
  ROOM_SORT_COLUMNS,
} from '@/lib/finance/reports';
import type { UnitRow, RoomPaymentRow, RoomExpenseRow } from '@/lib/finance/reports';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUnits(count: number): UnitRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `unit-${i + 1}`,
    label: `Room ${i + 1}`,
    property_name: `Property A`,
  }));
}

function makePayments(payments: Array<[string, number]>): RoomPaymentRow[] {
  return payments.map(([unit_id, amount]) => ({ unit_id, amount }));
}

function makeExpenses(expenses: Array<[string | null, number]>): RoomExpenseRow[] {
  return expenses.map(([unit_id, amount]) => ({ unit_id, amount }));
}

// ---------------------------------------------------------------------------
// ROOM_SORT_COLUMNS allowlist
// ---------------------------------------------------------------------------

describe('ROOM_SORT_COLUMNS allowlist', () => {
  it('contains net_profit', () => {
    expect(ROOM_SORT_COLUMNS).toContain('net_profit');
  });

  it('contains revenue', () => {
    expect(ROOM_SORT_COLUMNS).toContain('revenue');
  });

  it('contains expenses', () => {
    expect(ROOM_SORT_COLUMNS).toContain('expenses');
  });

  it('contains occupancy', () => {
    expect(ROOM_SORT_COLUMNS).toContain('occupancy');
  });

  it('has exactly 4 allowed columns', () => {
    expect(ROOM_SORT_COLUMNS).toHaveLength(4);
  });

  it('does NOT contain raw SQL injection strings', () => {
    const dangerous = ['1; DROP TABLE units', 'id DESC; --', 'org_id'];
    for (const d of dangerous) {
      expect(ROOM_SORT_COLUMNS).not.toContain(d);
    }
  });
});

// ---------------------------------------------------------------------------
// Pagination cap at 100
// ---------------------------------------------------------------------------

describe('Pagination cap at max 100 rows', () => {
  it('never returns more than 100 rows even if pageSize > 100', () => {
    const units = makeUnits(150);
    const result = computeRoomProfitability(
      units, [], [], new Set(), 'net_profit', 0, 200 // request 200 rows
    );
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('returns up to pageSize rows when pageSize <= 100', () => {
    const units = makeUnits(80);
    const result = computeRoomProfitability(
      units, [], [], new Set(), 'net_profit', 0, 50
    );
    expect(result.length).toBe(50);
  });

  it('returns remaining rows on last page', () => {
    const units = makeUnits(75);
    const result = computeRoomProfitability(
      units, [], [], new Set(), 'net_profit', 1, 50 // page 1 → rows 50-74
    );
    expect(result.length).toBe(25);
  });

  it('returns empty array for page beyond total', () => {
    const units = makeUnits(10);
    const result = computeRoomProfitability(
      units, [], [], new Set(), 'net_profit', 5, 50
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sort correctness
// ---------------------------------------------------------------------------

describe('Sort by net_profit (default)', () => {
  it('sorts descending by net_profit', () => {
    const units = makeUnits(3);
    // unit-1: revenue 1000, expenses 200 → net 800
    // unit-2: revenue 500,  expenses 100 → net 400
    // unit-3: revenue 300,  expenses 50  → net 250
    const payments = makePayments([
      ['unit-1', 1000],
      ['unit-2', 500],
      ['unit-3', 300],
    ]);
    const expenses = makeExpenses([
      ['unit-1', 200],
      ['unit-2', 100],
      ['unit-3', 50],
    ]);

    const result = computeRoomProfitability(
      units, payments, expenses, new Set(), 'net_profit', 0, 50
    );

    expect(result[0].unit_id).toBe('unit-1');
    expect(result[1].unit_id).toBe('unit-2');
    expect(result[2].unit_id).toBe('unit-3');
  });
});

describe('Sort by revenue', () => {
  it('sorts descending by revenue', () => {
    const units = makeUnits(3);
    const payments = makePayments([
      ['unit-1', 100],
      ['unit-2', 900],
      ['unit-3', 500],
    ]);

    const result = computeRoomProfitability(
      units, payments, [], new Set(), 'revenue', 0, 50
    );

    expect(result[0].unit_id).toBe('unit-2'); // 900
    expect(result[1].unit_id).toBe('unit-3'); // 500
    expect(result[2].unit_id).toBe('unit-1'); // 100
  });
});

describe('Sort by expenses', () => {
  it('sorts descending by expenses', () => {
    const units = makeUnits(3);
    const expenses = makeExpenses([
      ['unit-1', 800],
      ['unit-2', 200],
      ['unit-3', 500],
    ]);

    const result = computeRoomProfitability(
      units, [], expenses, new Set(), 'expenses', 0, 50
    );

    expect(result[0].unit_id).toBe('unit-1'); // 800
    expect(result[1].unit_id).toBe('unit-3'); // 500
    expect(result[2].unit_id).toBe('unit-2'); // 200
  });
});

describe('Sort by occupancy', () => {
  it('puts occupied units first', () => {
    const units = makeUnits(3);
    const occupiedIds = new Set(['unit-2']);

    const result = computeRoomProfitability(
      units, [], [], occupiedIds, 'occupancy', 0, 50
    );

    // unit-2 is occupied (occupancy=1), others are 0
    expect(result[0].unit_id).toBe('unit-2');
    expect(result[0].occupancy).toBe(1);
    expect(result[1].occupancy).toBe(0);
    expect(result[2].occupancy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Data aggregation correctness
// ---------------------------------------------------------------------------

describe('Data aggregation', () => {
  it('aggregates multiple payment rows for the same unit', () => {
    const units = makeUnits(1);
    const payments = makePayments([
      ['unit-1', 300],
      ['unit-1', 400],
      ['unit-1', 100],
    ]);

    const result = computeRoomProfitability(
      units, payments, [], new Set(), 'net_profit', 0, 50
    );

    expect(result[0].revenue).toBe(800);
  });

  it('excludes expenses with null unit_id from per-unit totals', () => {
    const units = makeUnits(1);
    const expenses = makeExpenses([
      [null, 9999],  // org-level expense, no unit_id
      ['unit-1', 200],
    ]);

    const result = computeRoomProfitability(
      units, [], expenses, new Set(), 'net_profit', 0, 50
    );

    expect(result[0].expenses).toBe(200); // 9999 not counted
  });

  it('returns correct net_profit = revenue - expenses', () => {
    const units = makeUnits(1);
    const payments = makePayments([['unit-1', 1500]]);
    const expenses = makeExpenses([['unit-1', 400]]);

    const result = computeRoomProfitability(
      units, payments, expenses, new Set(), 'net_profit', 0, 50
    );

    expect(result[0].net_profit).toBe(1100);
  });

  it('includes unit in result even with zero revenue and expenses', () => {
    const units = makeUnits(3);
    const result = computeRoomProfitability(
      units, [], [], new Set(), 'net_profit', 0, 50
    );

    expect(result).toHaveLength(3);
    for (const row of result) {
      expect(row.revenue).toBe(0);
      expect(row.expenses).toBe(0);
      expect(row.net_profit).toBe(0);
    }
  });

  it('occupancy flag is 1 for occupied units, 0 for vacant', () => {
    const units = makeUnits(2);
    const occupiedIds = new Set(['unit-1']);

    const result = computeRoomProfitability(
      units, [], [], occupiedIds, 'net_profit', 0, 50
    );

    const unit1 = result.find((r) => r.unit_id === 'unit-1');
    const unit2 = result.find((r) => r.unit_id === 'unit-2');
    expect(unit1?.occupancy).toBe(1);
    expect(unit2?.occupancy).toBe(0);
  });
});
