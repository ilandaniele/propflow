/**
 * Real-SQL smoke test for src/lib/agent/metrics.ts (see setup.ts's header for
 * why this exists alongside tests/unit/agent/metrics.test.ts, which mocks
 * `@/lib/db` entirely and only asserts the *shape* of the emitted SQL). This
 * file runs `getAgentMetrics` against a real (PGlite) Postgres so the
 * `GROUPING SETS`, `to_char(... AT TIME ZONE ...)`, and `percentile_cont`
 * queries are actually parsed and executed, not just pattern-matched.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  createSmokeDb,
  seedOrg,
  seedProfile,
  seedAgentConfig,
  seedLead,
  seedSession,
  seedMessage,
  seedEvent,
  seedVisit,
  seedCall,
  type SmokeDb,
} from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('getAgentMetrics (real SQL)', () => {
  it('aggregates whatsapp/web/voice into the GROUPING SETS rollup and returns YYYY-MM-DD daily keys', async () => {
    const { db } = await import('@/lib/db');
    const { getAgentMetrics } = await import('@/lib/agent/metrics');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, { timezone: 'UTC' });
    const advisor = await seedProfile(typedDb, org.id, { role: 'admin' });

    const inRange = new Date('2024-06-10T10:00:00Z');

    // ── conversations: one whatsapp session, one web session ──────────────
    const waSession = await seedSession(typedDb, org.id, { channel: 'whatsapp', createdAt: inRange });
    const webSession = await seedSession(typedDb, org.id, { channel: 'web', createdAt: inRange });

    // ── leads: one per channel, one qualified ──────────────────────────────
    const waLead = await seedLead(typedDb, org.id, {
      sourceChannel: 'whatsapp',
      stage: 'qualified',
      createdAt: inRange,
    });
    await seedLead(typedDb, org.id, { sourceChannel: 'web', createdAt: inRange });

    // ── a visit booked from the whatsapp lead ──────────────────────────────
    await seedVisit(typedDb, org.id, {
      leadId: waLead.id,
      profileId: advisor.id,
      sourceChannel: 'whatsapp',
      status: 'scheduled',
      startsAt: inRange,
      endsAt: new Date(inRange.getTime() + 45 * 60_000),
      blockedUntil: new Date(inRange.getTime() + 60 * 60_000),
      createdBy: 'agent',
      createdAt: inRange,
    });

    // ── a handoff event on the whatsapp session ────────────────────────────
    await seedEvent(typedDb, org.id, waSession.id, { kind: 'handoff', data: { reason: 'complaint' }, createdAt: inRange });

    // ── AI cost on both sessions ────────────────────────────────────────────
    await seedMessage(typedDb, org.id, waSession.id, { role: 'assistant', costUsd: '0.01', createdAt: inRange });
    await seedMessage(typedDb, org.id, webSession.id, { role: 'assistant', costUsd: '0.02', createdAt: inRange });

    // ── one voice call ──────────────────────────────────────────────────────
    await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      outcome: 'answered',
      durationSeconds: 90,
      costUsd: '0.05',
      createdAt: inRange,
    });

    const result = await getAgentMetrics(org.id, {
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-20T00:00:00Z'),
    });

    // Daily series keys are plain 'YYYY-MM-DD' strings, never a JS Date leaking
    // through the to_char(...) cast (postgres.js can hand back a Date for a
    // date/timestamp-typed column depending on the driver path).
    expect(result.daily.length).toBeGreaterThan(0);
    for (const day of result.daily) {
      expect(day.day).toMatch(DAY_RE);
    }
    const juneTenth = result.daily.find((d) => d.day === '2024-06-10');
    expect(juneTenth).toEqual({ day: '2024-06-10', conversations: 2, leads: 2, visitsBooked: 1 });

    // The `all` rollup (channel IS NULL / GROUPING(channel)=1 row) must equal
    // the sum of the per-channel rows from the SAME query — not a separate
    // recomputation that could drift.
    const { byChannel } = result;
    expect(byChannel.all.conversations).toBe(byChannel.whatsapp.conversations + byChannel.web.conversations + byChannel.voice.conversations);
    expect(byChannel.all.leads).toBe(byChannel.whatsapp.leads + byChannel.web.leads + byChannel.voice.leads);
    expect(byChannel.all.visitsBooked).toBe(byChannel.whatsapp.visitsBooked + byChannel.web.visitsBooked + byChannel.voice.visitsBooked);
    expect(byChannel.all.handoffs).toBe(byChannel.whatsapp.handoffs + byChannel.web.handoffs + byChannel.voice.handoffs);
    expect(byChannel.all.aiCostUsd).toBeCloseTo(byChannel.whatsapp.aiCostUsd + byChannel.web.aiCostUsd + byChannel.voice.aiCostUsd, 6);

    expect(byChannel.whatsapp.conversations).toBe(1);
    expect(byChannel.web.conversations).toBe(1);
    expect(byChannel.whatsapp.leads).toBe(1);
    expect(byChannel.whatsapp.qualifiedLeads).toBe(1);
    expect(byChannel.whatsapp.visitsBooked).toBe(1);
    expect(byChannel.whatsapp.handoffs).toBe(1);
    expect(byChannel.voice.calls).toBe(1);
    expect(byChannel.voice.answeredCalls).toBe(1);
    expect(byChannel.voice.voiceMinutes).toBe(2); // ceil(90s / 60)
    expect(byChannel.all.calls).toBe(1);
  });
});
