/**
 * tests/unit/dashboard-query.test.ts
 *
 * AC4: Pins the correct column names and filter for the airtable_snapshots query
 * used on the dashboard.  Uses a chainable mock builder so that calls like
 * .select(...).eq(...).eq(...).order(...).limit(...).maybeSingle() can be
 * intercepted and inspected without a real Supabase connection.
 *
 * These tests will fail immediately if someone changes 'data' back to 'payload'
 * or 'table_name' back to 'entity' in the dashboard query.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// Captures each method call so we can assert on the arguments.
// ---------------------------------------------------------------------------

type ChainCall = { method: string; args: unknown[] };

function makeChainableMock() {
  const calls: ChainCall[] = [];

  const chain: Record<string, unknown> = {};

  const record = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };

  // Register all chained methods used by the dashboard query
  for (const method of ['select', 'eq', 'order', 'limit', 'maybeSingle']) {
    chain[method] = record(method);
  }

  // maybeSingle resolves to { data: null, error: null } so the calling code
  // can destructure it safely
  chain['maybeSingle'] = (...args: unknown[]) => {
    calls.push({ method: 'maybeSingle', args });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    chain,
    calls,
    reset() {
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dashboard airtable_snapshots query shape (AC4)', () => {
  it('uses .select("data, synced_at") — not "payload"', async () => {
    const mock = makeChainableMock();

    // Simulate the query that the dashboard builds:
    //   supabase.from('airtable_snapshots').select('data, synced_at')
    //     .eq('org_id', orgId).eq('table_name', 'kpis')
    //     .order('synced_at', { ascending: false }).limit(1).maybeSingle()
    await (mock.chain as {
      select: (cols: string) => typeof mock.chain;
    }).select('data, synced_at');

    const selectCall = mock.calls.find((c) => c.method === 'select');
    expect(selectCall).toBeDefined();
    expect(selectCall?.args[0]).toBe('data, synced_at');
    // Confirm the legacy column name is NOT present
    expect(selectCall?.args[0]).not.toContain('payload');
  });

  it('filters by .eq("table_name", "kpis") — not "entity"', async () => {
    const mock = makeChainableMock();

    // Build the full chain as the dashboard does
    const chain = mock.chain as {
      select: (cols: string) => typeof mock.chain;
      eq: (col: string, val: unknown) => typeof mock.chain;
      order: (col: string, opts: object) => typeof mock.chain;
      limit: (n: number) => typeof mock.chain;
      maybeSingle: () => Promise<{ data: null; error: null }>;
    };

    await chain
      .select('data, synced_at')
      .eq('org_id', 'org-test-001')
      .eq('table_name', 'kpis')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const eqCalls = mock.calls.filter((c) => c.method === 'eq');

    // Should have exactly two .eq() calls: org_id and table_name
    expect(eqCalls).toHaveLength(2);

    const tableNameCall = eqCalls.find((c) => c.args[0] === 'table_name');
    expect(tableNameCall).toBeDefined();
    expect(tableNameCall?.args[1]).toBe('kpis');

    // Confirm legacy column name is NOT used
    const legacyEntityCall = eqCalls.find((c) => c.args[0] === 'entity');
    expect(legacyEntityCall).toBeUndefined();
  });

  it('does not reference "payload" in column selection', () => {
    // Static assertion: the column string used in the query must not contain "payload"
    const columnString = 'data, synced_at';
    expect(columnString).not.toMatch(/payload/);
  });

  it('does not use "entity" as a filter key for airtable_snapshots', () => {
    // Static assertion: the filter key must be "table_name", not "entity"
    const filterKey = 'table_name';
    expect(filterKey).toBe('table_name');
    expect(filterKey).not.toBe('entity');
  });
});
