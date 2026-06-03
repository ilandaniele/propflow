/**
 * tests/unit/finance/leak-detector.test.ts
 *
 * Unit tests for detectHiddenLeaks (AC14):
 *   - Returns findings when billed - collected > 15% AND amount > 0
 *   - Returns empty array when gap ≤ 15%
 *   - Edge cases: zero billed, zero collected, exact 15%, just above
 *   - Severity classification: medium vs high
 *   - Sort order: worst first (highest gap ratio)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectHiddenLeaks } from '@/lib/finance/leak-detector';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Test factory — builds a mock Supabase client from fixture data
// ---------------------------------------------------------------------------

interface Unit {
  id: string;
  label: string;
}

interface Charge {
  tenant_id: string;
  amount: number;
}

interface Payment {
  contract_id: string;
  amount: number;
  paid_at: string;
}

interface Tenant {
  id: string;
  unit_id: string | null;
}

interface Contract {
  id: string;
  unit_id: string;
}

function buildMockSupabase(fixture: {
  units: Unit[];
  charges: Charge[];
  payments: Payment[];
  tenants: Tenant[];
  contracts: Contract[];
}): SupabaseClient {
  // Create a chainable query builder that resolves to data on .select()
  // We use a simple state machine per from() call.
  const fromImpl = (table: string) => {
    let _filterFns: Array<(row: Record<string, unknown>) => boolean> = [];
    let _selectCols = '';
    let _inFilter: { col: string; vals: string[] } | null = null;

    const builder = {
      select: (cols: string) => {
        _selectCols = cols;
        return builder;
      },
      eq: (_col: string, _val: unknown) => builder,
      neq: (_col: string, _val: unknown) => builder,
      gte: (_col: string, _val: unknown) => builder,
      lt: (_col: string, _val: unknown) => builder,
      in: (col: string, vals: string[]) => {
        _inFilter = { col, vals };
        return builder;
      },
      // Resolves the query
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
        let rows: unknown[] = [];
        if (table === 'units') rows = fixture.units;
        else if (table === 'charges') rows = fixture.charges;
        else if (table === 'payments') rows = fixture.payments;
        else if (table === 'tenants') {
          rows = _inFilter
            ? fixture.tenants.filter((t) => _inFilter!.vals.includes(t[_inFilter!.col as keyof Tenant] as string))
            : fixture.tenants;
        } else if (table === 'contracts') {
          rows = _inFilter
            ? fixture.contracts.filter((c) => _inFilter!.vals.includes(c[_inFilter!.col as keyof Contract] as string))
            : fixture.contracts;
        }
        resolve({ data: rows, error: null });
      },
    };
    return builder as unknown as ReturnType<SupabaseClient['from']>;
  };

  return { from: fromImpl } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeUnit = (id: string, label: string): Unit => ({ id, label });
const makeTenant = (id: string, unit_id: string): Tenant => ({ id, unit_id });
const makeContract = (id: string, unit_id: string): Contract => ({ id, unit_id });
const makeCharge = (tenant_id: string, amount: number): Charge => ({ tenant_id, amount });
const makePayment = (contract_id: string, amount: number, paid_at = '2026-06-15'): Payment => ({
  contract_id,
  amount,
  paid_at,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectHiddenLeaks', () => {
  it('returns empty array when there are no units', async () => {
    const supabase = buildMockSupabase({
      units: [],
      charges: [],
      payments: [],
      tenants: [],
      contracts: [],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toEqual([]);
  });

  it('returns empty array when gap is exactly 15% (not > 15%)', async () => {
    // billed=100, collected=85 → gap=15 → gapRatio=0.15 → NOT > 0.15 → no finding
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 100)],
      payments: [makePayment('c1', 85)],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(0);
  });

  it('returns finding when gap is > 15%', async () => {
    // billed=100, collected=80 → gap=20 → gapRatio=0.20 → > 0.15 → finding
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1A')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 100)],
      payments: [makePayment('c1', 80)],
    });
    const result = await detectHiddenLeaks(supabase);
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
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 2B')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 100)],
      payments: [makePayment('c1', 60)],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('high');
  });

  it('returns empty when gap is zero (collected === billed)', async () => {
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 500)],
      payments: [makePayment('c1', 500)],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(0);
  });

  it('returns empty when nothing is billed (billed=0)', async () => {
    // No charges → billed=0 → skip
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [],
      payments: [],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(0);
  });

  it('returns empty when collected > billed (overpayment, gap < 0)', async () => {
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 100)],
      payments: [makePayment('c1', 120)], // overpaid
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(0);
  });

  it('returns only units with gap > 15% when multiple units are present', async () => {
    // Unit u1: 100 billed, 80 collected → gap=20% → finding
    // Unit u2: 100 billed, 90 collected → gap=10% → no finding
    // Unit u3: 100 billed, 50 collected → gap=50% → finding (high)
    const supabase = buildMockSupabase({
      units: [
        makeUnit('u1', 'Room A'),
        makeUnit('u2', 'Room B'),
        makeUnit('u3', 'Room C'),
      ],
      tenants: [
        makeTenant('t1', 'u1'),
        makeTenant('t2', 'u2'),
        makeTenant('t3', 'u3'),
      ],
      contracts: [
        makeContract('c1', 'u1'),
        makeContract('c2', 'u2'),
        makeContract('c3', 'u3'),
      ],
      charges: [
        makeCharge('t1', 100),
        makeCharge('t2', 100),
        makeCharge('t3', 100),
      ],
      payments: [
        makePayment('c1', 80),
        makePayment('c2', 90),
        makePayment('c3', 50),
      ],
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(2);
    // Sorted by gapRatio descending: u3 (0.5) before u1 (0.2)
    expect(result[0].unitId).toBe('u3');
    expect(result[0].severity).toBe('high');
    expect(result[1].unitId).toBe('u1');
    expect(result[1].severity).toBe('medium');
    // u2 is NOT in results
    expect(result.find((f) => f.unitId === 'u2')).toBeUndefined();
  });

  it('aggregates multiple charges for the same unit', async () => {
    // Two charges for same tenant → billed=200 total
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Room 1')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 100), makeCharge('t1', 100)],
      payments: [makePayment('c1', 150)], // collected=150, billed=200, gap=25%
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result).toHaveLength(1);
    expect(result[0].billedTotal).toBe(200);
    expect(result[0].collectedTotal).toBe(150);
    expect(result[0].amount).toBe(50);
  });

  it('description string contains unit label, amounts, and percentage', async () => {
    const supabase = buildMockSupabase({
      units: [makeUnit('u1', 'Suite 3')],
      tenants: [makeTenant('t1', 'u1')],
      contracts: [makeContract('c1', 'u1')],
      charges: [makeCharge('t1', 200)],
      payments: [makePayment('c1', 120)], // gap=80/200=40%
    });
    const result = await detectHiddenLeaks(supabase);
    expect(result[0].description).toContain('Suite 3');
    expect(result[0].description).toContain('200.00');
    expect(result[0].description).toContain('120.00');
    expect(result[0].description).toContain('40%');
  });
});
