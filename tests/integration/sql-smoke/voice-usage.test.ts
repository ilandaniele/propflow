/**
 * Real-SQL smoke test for src/lib/agent/voice/usage.ts — getMonthlyVoiceUsage
 * (drizzle query-builder aggregate, not a raw `sql\`...\`` template) and
 * failStaleCalls (a per-org sweep UPDATE ... RETURNING).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedAgentConfig, seedCall, type SmokeDb } from './setup';

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

describe('voice usage (real SQL)', () => {
  it('getMonthlyVoiceUsage sums this org-tz month and counts in-flight calls', async () => {
    const { db } = await import('@/lib/db');
    const { getMonthlyVoiceUsage } = await import('@/lib/agent/voice/usage');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const now = new Date('2024-06-15T12:00:00Z');

    // Ended this month — counts toward usedMinutes (ceil(125s/60) = 3).
    await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      status: 'ended',
      durationSeconds: 125,
      createdAt: new Date('2024-06-01T00:00:00Z'),
    });
    // Ended last month — must not count.
    await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      status: 'ended',
      durationSeconds: 600,
      createdAt: new Date('2024-05-30T00:00:00Z'),
    });
    // Still in-flight this month, recent enough to reserve.
    await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      status: 'dialing',
      createdAt: new Date(now.getTime() - 60_000),
    });

    const usage = await getMonthlyVoiceUsage(org.id, 'UTC', 10, now);

    expect(usage.usedMinutes).toBe(3);
    expect(usage.inFlightCalls).toBe(1);
  });

  it('failStaleCalls marks a stuck dialing/in_progress row failed using the org\'s own maxCallMinutes', async () => {
    const { db } = await import('@/lib/db');
    const { failStaleCalls } = await import('@/lib/agent/voice/usage');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, { voiceConfig: { maxCallMinutes: 5 } });

    const now = new Date('2024-06-15T12:00:00Z');
    // Created 20 minutes ago, cap is 5 min + 5 min slack = 10 min cutoff — stale.
    const stale = await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      status: 'dialing',
      createdAt: new Date(now.getTime() - 20 * 60_000),
    });
    // Created 1 minute ago — still legitimately in-flight.
    const fresh = await seedCall(typedDb, org.id, {
      direction: 'outbound',
      purpose: 'speed_to_lead',
      status: 'in_progress',
      createdAt: new Date(now.getTime() - 60_000),
    });

    const failed = await failStaleCalls(now);

    expect(failed).toBe(1);

    const rows = (await typedDb.execute(
      sql`SELECT id, status, block_reason FROM agent_calls WHERE org_id = ${org.id} ORDER BY created_at`,
    )) as Array<{ id: string; status: string; block_reason: string | null }>;

    const staleRow = rows.find((r) => r.id === stale.id);
    const freshRow = rows.find((r) => r.id === fresh.id);
    expect(staleRow).toEqual({ id: stale.id, status: 'failed', block_reason: 'stale' });
    expect(freshRow?.status).toBe('in_progress');
  });
});
