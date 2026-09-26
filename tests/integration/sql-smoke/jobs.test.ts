/**
 * Real-SQL smoke test for src/lib/agent/jobs.ts's claimDueJobs (private, only
 * reachable through drainAgentJobs) — the `FOR UPDATE SKIP LOCKED` claim.
 * tests/unit/agent/jobs.test.ts mocks `@/lib/db` entirely, so it can never
 * catch a real Postgres syntax error in the `.for('update', { skipLocked:
 * true })` builder call; this does.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('agent job queue (real SQL)', () => {
  it('drainAgentJobs claims a due, registered-kind job with FOR UPDATE SKIP LOCKED and runs its handler', async () => {
    const { db } = await import('@/lib/db');
    const jobs = await import('@/lib/agent/jobs');
    const typedDb = db as unknown as SmokeDb;

    jobs._resetAgentJobHandlers();
    const handled: unknown[] = [];
    jobs.registerAgentJobHandler('noop', async (payload) => {
      handled.push(payload);
    });

    const org = await seedOrg(typedDb);
    const jobId = await jobs.enqueueJob({ orgId: org.id, kind: 'noop', payload: { foo: 'bar' }, runAt: new Date(Date.now() - 1000) });
    // An unregistered kind, also due — must be left alone (never claimed).
    await jobs.enqueueJob({ orgId: org.id, kind: 'unregistered', runAt: new Date(Date.now() - 1000) });
    // Registered kind, but not due yet — must be left alone.
    await jobs.enqueueJob({ orgId: org.id, kind: 'noop', runAt: new Date(Date.now() + 60 * 60_000) });

    const result = await jobs.drainAgentJobs(20);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(handled).toEqual([{ foo: 'bar' }]);

    const rows = (await db.execute(sql`SELECT id, status FROM agent_jobs WHERE id = ${jobId}`)) as Array<{ id: string; status: string }>;
    expect(rows[0]?.status).toBe('done');

    jobs._resetAgentJobHandlers();
  });
});
