import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('agent/pricing — estimateCostUsd', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.AGENT_PRICE_IN_PER_MTOK;
    delete process.env.AGENT_PRICE_OUT_PER_MTOK;
    delete process.env.AGENT_PRICE_CACHE_READ_PER_MTOK;
    delete process.env.AGENT_PRICE_CACHE_WRITE_PER_MTOK;
    // pricing.ts reads env once at module load — force a fresh evaluation per test.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('computes cost from the default rates (5/25/0.5/6.25 per MTOK)', async () => {
    const { estimateCostUsd } = await import('@/lib/agent/pricing');
    // 1,000,000 input @ $5 + 1,000,000 output @ $25 = $30
    const cost = estimateCostUsd({ input: 1_000_000, output: 1_000_000 });
    expect(cost).toBeCloseTo(30, 6);
  });

  it('includes cacheRead/cacheWrite at their own rates', async () => {
    const { estimateCostUsd } = await import('@/lib/agent/pricing');
    const cost = estimateCostUsd({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 });
    expect(cost).toBeCloseTo(0.5 + 6.25, 6);
  });

  it('returns 0 for zero usage', async () => {
    const { estimateCostUsd } = await import('@/lib/agent/pricing');
    expect(estimateCostUsd({ input: 0, output: 0 })).toBe(0);
  });

  it('scales linearly with token count', async () => {
    const { estimateCostUsd } = await import('@/lib/agent/pricing');
    const small = estimateCostUsd({ input: 1000, output: 200 });
    const big = estimateCostUsd({ input: 10_000, output: 2000 });
    expect(big).toBeCloseTo(small * 10, 9);
  });

  it('honours AGENT_PRICE_* env overrides', async () => {
    process.env.AGENT_PRICE_IN_PER_MTOK = '10';
    process.env.AGENT_PRICE_OUT_PER_MTOK = '50';
    const { estimateCostUsd, COST_SQL_RATES } = await import('@/lib/agent/pricing');
    expect(COST_SQL_RATES.inPerMtok).toBe(10);
    expect(COST_SQL_RATES.outPerMtok).toBe(50);
    const cost = estimateCostUsd({ input: 1_000_000, output: 1_000_000 });
    expect(cost).toBeCloseTo(60, 6);
  });

  it('falls back to the default when an env rate is not a valid number', async () => {
    process.env.AGENT_PRICE_IN_PER_MTOK = 'not-a-number';
    const { COST_SQL_RATES } = await import('@/lib/agent/pricing');
    expect(COST_SQL_RATES.inPerMtok).toBe(5);
  });
});
