/**
 * tests/unit/agent/metrics.test.ts — Phase 8-9, item E.
 *
 * `getAgentMetrics` is exercised against a fully mocked `@/lib/db` (a queue
 * of canned `db.execute` results, consumed in call order) so these are
 * "SQL-shape" tests: they assert every emitted query has no `LIMIT` before
 * its aggregate, excludes playground sessions, and that the `all` rollup
 * (the `GROUP BY GROUPING SETS ((channel), ())` grand-total row) equals the
 * sum of the per-channel rows returned by the SAME query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn(async () => ({ timezone: 'America/Lima' })),
}));

const executedQueries: SQL[] = [];
const resultQueue: unknown[][] = [];

vi.mock('@/lib/db', () => ({
  db: {
    execute: vi.fn(async (q: SQL) => {
      executedQueries.push(q);
      return resultQueue.shift() ?? [];
    }),
  },
}));

// Renders a drizzle `sql` template's chunks back to plain text for assertions —
// test-only introspection, never shipped in production code.
function sqlText(q: SQL): string {
  const chunks = (q as unknown as { queryChunks: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join('') : String(v);
      }
      return typeof c === 'string' ? c : '?';
    })
    .join('');
}

import { getAgentMetrics, resolveRange } from '@/lib/agent/metrics';

function push(rows: unknown[]): void {
  resultQueue.push(rows);
}

beforeEach(() => {
  executedQueries.length = 0;
  resultQueue.length = 0;
});

const ORG_ID = 'org-1';
const RANGE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T00:00:00Z') };

/** Queues one empty-ish response per db.execute call getAgentMetrics makes (in order). */
function queueDefaults(overrides: { conversations?: unknown[]; leads?: unknown[]; visits?: unknown[]; handoffs?: unknown[]; cost?: unknown[]; calls?: unknown[]; firstResponse?: unknown[] } = {}): void {
  push(overrides.conversations ?? []); // conversations
  push(overrides.leads ?? []); // leads
  push(overrides.visits ?? []); // visits
  push(overrides.handoffs ?? []); // handoffs
  push(overrides.cost ?? []); // ai cost
  push(overrides.calls ?? [{ calls: '0', answered: '0', minutes: '0', cost: '0' }]); // agent_calls totals
  push(overrides.firstResponse ?? []); // first response
  // daily series: 3 calls, Promise.all — order is sessions, leads, visits
  push([]);
  push([]);
  push([]);
}

describe('agent/metrics — getAgentMetrics', () => {
  it('every query has no LIMIT before its aggregate', async () => {
    queueDefaults();
    await getAgentMetrics(ORG_ID, RANGE);
    for (const q of executedQueries) {
      expect(sqlText(q).toLowerCase()).not.toMatch(/\blimit\b/);
    }
  });

  it('excludes playground sessions from every session-scoped query', async () => {
    queueDefaults();
    await getAgentMetrics(ORG_ID, RANGE);
    const sessionScoped = executedQueries.filter((q) => sqlText(q).includes('agent_sessions'));
    expect(sessionScoped.length).toBeGreaterThan(0);
    for (const q of sessionScoped) {
      expect(sqlText(q)).toContain("external_id NOT LIKE 'playground:%'");
    }
  });

  it('the all rollup equals the sum of the per-channel rows from the same query', async () => {
    queueDefaults({
      conversations: [
        { channel: 'whatsapp', n: '3' },
        { channel: 'web', n: '2' },
        { channel: 'voice', n: '1' },
        { channel: null, n: '6' },
      ],
    });
    const metrics = await getAgentMetrics(ORG_ID, RANGE);
    expect(metrics.byChannel.whatsapp.conversations).toBe(3);
    expect(metrics.byChannel.web.conversations).toBe(2);
    expect(metrics.byChannel.voice.conversations).toBe(1);
    expect(metrics.byChannel.all.conversations).toBe(6);
    expect(
      metrics.byChannel.whatsapp.conversations + metrics.byChannel.web.conversations + metrics.byChannel.voice.conversations,
    ).toBe(metrics.byChannel.all.conversations);
  });

  it('zero conversations/leads/visits → every derived ratio is null, not NaN or 0', async () => {
    queueDefaults();
    const metrics = await getAgentMetrics(ORG_ID, RANGE);
    for (const bucket of ['whatsapp', 'web', 'voice', 'all'] as const) {
      const m = metrics.byChannel[bucket];
      expect(m.leadToVisitRate).toBeNull();
      expect(m.handoffRate).toBeNull();
      expect(m.costPerConversation).toBeNull();
      expect(m.costPerVisit).toBeNull();
      expect(m.firstResponseP50Sec).toBeNull();
      expect(m.firstResponseP90Sec).toBeNull();
    }
  });

  it('computes leadToVisitRate, handoffRate and cost-per-* ratios per channel', async () => {
    queueDefaults({
      leads: [{ channel: 'whatsapp', n: '10', qualified: '4' }, { channel: null, n: '10', qualified: '4' }],
      visits: [
        { channel: 'whatsapp', booked: '5', completed: '2', no_show: '1', visited_leads: '5' },
        { channel: null, booked: '5', completed: '2', no_show: '1', visited_leads: '5' },
      ],
      conversations: [{ channel: 'whatsapp', n: '20' }, { channel: null, n: '20' }],
      handoffs: [{ channel: 'whatsapp', handoffs: '2' }, { channel: null, handoffs: '2' }],
      cost: [{ channel: 'whatsapp', cost: '10' }, { channel: null, cost: '10' }],
    });
    const metrics = await getAgentMetrics(ORG_ID, RANGE);
    const wa = metrics.byChannel.whatsapp;
    expect(wa.leadToVisitRate).toBeCloseTo(0.5); // 5 visited leads / 10 leads
    expect(wa.handoffRate).toBeCloseTo(0.1); // 2 / 20
    expect(wa.costPerConversation).toBeCloseTo(0.5); // 10 / 20
    expect(wa.costPerVisit).toBeCloseTo(2); // 10 / 5
  });

  it('agent_calls totals feed the voice bucket and roll up into all', async () => {
    queueDefaults({ calls: [{ calls: '4', answered: '3', minutes: '12', cost: '1.5' }] });
    const metrics = await getAgentMetrics(ORG_ID, RANGE);
    expect(metrics.byChannel.voice.calls).toBe(4);
    expect(metrics.byChannel.voice.answeredCalls).toBe(3);
    expect(metrics.byChannel.voice.voiceMinutes).toBe(12);
    expect(metrics.byChannel.voice.aiCostUsd).toBeCloseTo(1.5);
    expect(metrics.byChannel.all.calls).toBe(4);
    expect(metrics.byChannel.all.aiCostUsd).toBeCloseTo(1.5);
  });

  it('reports the timezone from the org config and the resolved range as ISO strings', async () => {
    queueDefaults();
    const metrics = await getAgentMetrics(ORG_ID, RANGE);
    expect(metrics.timezone).toBe('America/Lima');
    expect(metrics.from).toBe(RANGE.from.toISOString());
    expect(metrics.to).toBe(RANGE.to.toISOString());
  });

  it('builds one zero-filled daily row per calendar day in range', async () => {
    queueDefaults();
    const metrics = await getAgentMetrics(ORG_ID, { from: new Date('2026-01-01T05:00:00Z'), to: new Date('2026-01-04T05:00:00Z') });
    expect(metrics.daily).toHaveLength(3);
    expect(metrics.daily.every((d) => d.conversations === 0 && d.leads === 0 && d.visitsBooked === 0)).toBe(true);
  });
});

describe('agent/metrics — resolveRange', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('defaults to 30 days', () => {
    const { from, to } = resolveRange({}, 'America/Lima', now);
    expect(to.getTime()).toBe(now.getTime());
    expect(to.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('honours 7d and 90d', () => {
    expect(resolveRange({ range: '7d' }, 'America/Lima', now).to.getTime() - resolveRange({ range: '7d' }, 'America/Lima', now).from.getTime())
      .toBe(7 * 24 * 60 * 60 * 1000);
    expect(resolveRange({ range: '90d' }, 'America/Lima', now).to.getTime() - resolveRange({ range: '90d' }, 'America/Lima', now).from.getTime())
      .toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('custom range spans the full inclusive day boundaries in the org timezone', () => {
    const { from, to } = resolveRange({ range: 'custom', from: '2026-01-01', to: '2026-01-02' }, 'America/Lima', now);
    // America/Lima is UTC-5 year-round (no DST) — local midnight Jan 1 is 05:00 UTC.
    expect(from.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-03T05:00:00.000Z');
  });

  it('clamps a custom range longer than 366 days', () => {
    const { from, to } = resolveRange({ range: 'custom', from: '2020-01-01', to: '2026-01-01' }, 'UTC', now);
    expect(to.getTime() - from.getTime()).toBe(366 * 24 * 60 * 60 * 1000);
  });

  it('falls back to the 30d default on an invalid custom range', () => {
    const { from, to } = resolveRange({ range: 'custom', from: 'not-a-date', to: '2026-01-02' }, 'America/Lima', now);
    expect(to.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('falls back to the 30d default on an invalid timezone', () => {
    const { from, to } = resolveRange({ range: 'custom', from: '2026-01-01', to: '2026-01-02' }, 'Not/AZone', now);
    expect(to.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
