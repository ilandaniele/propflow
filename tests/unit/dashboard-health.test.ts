/**
 * tests/unit/dashboard-health.test.ts
 *
 * AC3: Unit tests for checkEntityHealth in src/lib/dashboard/health.ts
 *
 * Covers:
 * - Happy path: each entity returns its count
 * - Per-entity isolation: one entity erroring via supabase error does not block others
 * - Per-entity isolation: one entity throwing does not block others
 * - Generic error strings in Spanish (no raw DB messages)
 * - org_id scope: every query includes .eq('org_id', orgId)
 */

import { describe, it, expect } from 'vitest';
import { checkEntityHealth } from '@/lib/dashboard/health';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers: build a mock Supabase client where .from(table) returns a chain
// whose final promise resolves to a per-table outcome.
//
// outcomeMap: Record<tableName, { count: number | null; error: object | null; throws?: true }>
// ---------------------------------------------------------------------------

type TableOutcome = {
  count: number | null;
  error: { message: string; code: string } | null;
  throws?: boolean;
};

function makeSupabaseMock(outcomeMap: Record<string, TableOutcome>): {
  client: SupabaseClient;
  eqCallsByTable: Record<string, Array<[string, unknown]>>;
} {
  // Track .eq() calls per table so we can assert org_id scoping
  const eqCallsByTable: Record<string, Array<[string, unknown]>> = {};

  const client = {
    from(table: string) {
      const outcome = outcomeMap[table] ?? { count: 0, error: null };
      eqCallsByTable[table] = eqCallsByTable[table] ?? [];

      const chain: Record<string, unknown> = {};

      chain['select'] = () => chain;

      chain['eq'] = (col: string, val: unknown) => {
        eqCallsByTable[table].push([col, val]);
        return chain;
      };

      // Terminal: returns a promise that resolves or throws based on outcomeMap
      Object.defineProperty(chain, 'then', {
        get() {
          const promise = outcome.throws
            ? Promise.reject(new Error(`DB exploded for ${table}`))
            : Promise.resolve({ count: outcome.count, error: outcome.error });
          return promise.then.bind(promise);
        },
      });

      return chain;
    },
  } as unknown as SupabaseClient;

  return { client, eqCallsByTable };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';

describe('checkEntityHealth — happy path', () => {
  it('returns correct counts for all entities when all queries succeed', async () => {
    const { client } = makeSupabaseMock({
      tenants:    { count: 5,  error: null },
      properties: { count: 3,  error: null },
      payments:   { count: 12, error: null },
      contracts:  { count: 2,  error: null },
    });

    const results = await checkEntityHealth(client, ORG_ID);

    expect(results).toHaveLength(4);

    const tenants = results.find((r) => r.entity === 'tenants');
    expect(tenants?.count).toBe(5);
    expect(tenants?.error).toBeNull();

    const payments = results.find((r) => r.entity === 'payments');
    expect(payments?.count).toBe(12);
    expect(payments?.error).toBeNull();
  });
});

describe('checkEntityHealth — per-entity isolation (supabase error)', () => {
  it('one entity returning a supabase error does not affect others', async () => {
    const { client } = makeSupabaseMock({
      tenants:    { count: null, error: { message: 'relation does not exist', code: '42P01' } },
      properties: { count: 7,   error: null },
      payments:   { count: 4,   error: null },
      contracts:  { count: 1,   error: null },
    });

    const results = await checkEntityHealth(client, ORG_ID);

    expect(results).toHaveLength(4);

    // Errored entity should return zero count and a generic Spanish error string
    const tenants = results.find((r) => r.entity === 'tenants');
    expect(tenants?.count).toBe(0);
    expect(tenants?.error).not.toBeNull();
    // Must be a generic Spanish string — NOT the raw DB message
    expect(tenants?.error).not.toContain('relation does not exist');
    expect(tenants?.error).not.toContain('42P01');
    expect(tenants?.error).toContain('Inquilinos');

    // Other entities must be unaffected
    const properties = results.find((r) => r.entity === 'properties');
    expect(properties?.count).toBe(7);
    expect(properties?.error).toBeNull();

    const payments = results.find((r) => r.entity === 'payments');
    expect(payments?.count).toBe(4);
    expect(payments?.error).toBeNull();
  });
});

describe('checkEntityHealth — per-entity isolation (thrown exception)', () => {
  it('one entity throwing does not block other entities', async () => {
    const { client } = makeSupabaseMock({
      tenants:    { count: 3,   error: null },
      properties: { count: 0,   error: null, throws: true },
      payments:   { count: 10,  error: null },
      contracts:  { count: 2,   error: null },
    });

    const results = await checkEntityHealth(client, ORG_ID);

    expect(results).toHaveLength(4);

    // Throwing entity must not propagate — returns generic Spanish error
    const properties = results.find((r) => r.entity === 'properties');
    expect(properties?.count).toBe(0);
    expect(properties?.error).not.toBeNull();
    expect(properties?.error).not.toContain('DB exploded');
    expect(properties?.error).toContain('Propiedades');

    // Other entities succeed normally
    const tenants = results.find((r) => r.entity === 'tenants');
    expect(tenants?.count).toBe(3);
    expect(tenants?.error).toBeNull();

    const payments = results.find((r) => r.entity === 'payments');
    expect(payments?.count).toBe(10);
    expect(payments?.error).toBeNull();
  });
});

describe('checkEntityHealth — generic error strings (AC3 security)', () => {
  it('error field contains Spanish generic message, not raw DB error message', async () => {
    const rawDbMessage = 'ERROR: permission denied for table tenants (code 42501)';
    const { client } = makeSupabaseMock({
      tenants:    { count: null, error: { message: rawDbMessage, code: '42501' } },
      properties: { count: 1,   error: null },
      payments:   { count: 1,   error: null },
      contracts:  { count: 1,   error: null },
    });

    const results = await checkEntityHealth(client, ORG_ID);
    const tenants = results.find((r) => r.entity === 'tenants');

    expect(tenants?.error).toBeDefined();
    // Raw DB message must not leak to callers
    expect(tenants?.error).not.toContain(rawDbMessage);
    expect(tenants?.error).not.toContain('42501');
    // Generic Spanish string expected
    expect(tenants?.error).toMatch(/No se pudo verificar/);
  });
});

describe('checkEntityHealth — org_id scope', () => {
  it('every query includes .eq("org_id", orgId)', async () => {
    const { client, eqCallsByTable } = makeSupabaseMock({
      tenants:    { count: 1, error: null },
      properties: { count: 1, error: null },
      payments:   { count: 1, error: null },
      contracts:  { count: 1, error: null },
    });

    await checkEntityHealth(client, ORG_ID);

    for (const table of ['tenants', 'properties', 'payments', 'contracts']) {
      const calls = eqCallsByTable[table] ?? [];
      const orgIdCall = calls.find(([col]) => col === 'org_id');
      expect(orgIdCall).toBeDefined();
      expect(orgIdCall?.[1]).toBe(ORG_ID);
    }
  });

  it('uses the orgId argument — not a hardcoded value', async () => {
    const DIFFERENT_ORG = 'org-different-999';
    const { client, eqCallsByTable } = makeSupabaseMock({
      tenants:    { count: 2, error: null },
      properties: { count: 2, error: null },
      payments:   { count: 2, error: null },
      contracts:  { count: 2, error: null },
    });

    await checkEntityHealth(client, DIFFERENT_ORG);

    for (const table of ['tenants', 'properties', 'payments', 'contracts']) {
      const orgIdCall = (eqCallsByTable[table] ?? []).find(([col]) => col === 'org_id');
      expect(orgIdCall?.[1]).toBe(DIFFERENT_ORG);
      expect(orgIdCall?.[1]).not.toBe(ORG_ID);
    }
  });
});
