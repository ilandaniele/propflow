/**
 * Real-SQL smoke test for src/lib/agent/jobs.ts's claimDueJobs (private, only
 * reachable through drainAgentJobs) — the atomic
 * `UPDATE ... WHERE id IN (SELECT ... LIMIT ?) RETURNING` claim — and for the
 * `?sweep=1` flag of POST /api/cron/agent-dispatch.
 * tests/unit/agent/jobs.test.ts mocks `@/lib/db` entirely, so it can never
 * catch a real SQLite error in the claim statement; this does.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/agent/job-handlers', () => ({ registerAgentJobHandlers: vi.fn() }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function jobStatus(id: string): Promise<string | undefined> {
  const rows = await smoke.db.execute<{ status: string }>(sql`SELECT status FROM agent_jobs WHERE id = ${id}`);
  return rows[0]?.status;
}

describe('agent job queue (real SQL)', () => {
  it('drainAgentJobs claims a due, registered-kind job and runs its handler', async () => {
    const jobs = await import('@/lib/agent/jobs');

    jobs._resetAgentJobHandlers();
    const handled: unknown[] = [];
    jobs.registerAgentJobHandler('noop', async (payload) => {
      handled.push(payload);
    });

    const org = await seedOrg(smoke.db);
    const jobId = await jobs.enqueueJob({ orgId: org.id, kind: 'noop', payload: { foo: 'bar' }, runAt: new Date(Date.now() - 1000) });
    // An unregistered kind, also due — must be left alone (never claimed).
    const unregisteredId = await jobs.enqueueJob({ orgId: org.id, kind: 'unregistered', runAt: new Date(Date.now() - 1000) });
    // Registered kind, but not due yet — must be left alone.
    const futureId = await jobs.enqueueJob({ orgId: org.id, kind: 'noop', runAt: new Date(Date.now() + 60 * 60_000) });

    const result = await jobs.drainAgentJobs(20);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(handled).toEqual([{ foo: 'bar' }]);
    expect(await jobStatus(jobId)).toBe('done');
    expect(await jobStatus(unregisteredId)).toBe('pending');
    expect(await jobStatus(futureId)).toBe('pending');

    jobs._resetAgentJobHandlers();
  });

  it('two concurrent drains never claim the same job', async () => {
    const jobs = await import('@/lib/agent/jobs');

    jobs._resetAgentJobHandlers();
    const handled: number[] = [];
    jobs.registerAgentJobHandler('concurrent', async (payload) => {
      handled.push(payload.n as number);
    });

    const org = await seedOrg(smoke.db);
    const ids: string[] = [];
    for (let n = 0; n < 6; n++) {
      ids.push(await jobs.enqueueJob({ orgId: org.id, kind: 'concurrent', payload: { n }, runAt: new Date(Date.now() - 1000) }));
    }

    const [a, b] = await Promise.all([jobs.drainAgentJobs(4), jobs.drainAgentJobs(4)]);

    expect(a.processed + b.processed).toBe(6);
    expect(handled.sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const id of ids) expect(await jobStatus(id)).toBe('done');

    jobs._resetAgentJobHandlers();
  });

  it('POST /api/cron/agent-dispatch?sweep=1 runs the sweep and does not drain', async () => {
    vi.stubEnv('CRON_SECRET', 'smoke-secret');
    const jobs = await import('@/lib/agent/jobs');
    const { POST } = await import('@/app/api/cron/agent-dispatch/route');

    jobs._resetAgentJobHandlers();
    jobs.registerAgentJobHandler('noop', async () => {});
    const org = await seedOrg(smoke.db);
    const jobId = await jobs.enqueueJob({ orgId: org.id, kind: 'noop', runAt: new Date(Date.now() - 1000) });

    const res = await POST(new NextRequest('http://localhost/api/cron/agent-dispatch?sweep=1', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-secret' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      staleInboundSwept: expect.any(Number),
      calendarSyncsEnqueued: expect.any(Number),
      speedToLeadCalls: expect.any(Number),
      visitConfirmationCalls: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(await jobStatus(jobId)).toBe('pending');

    jobs._resetAgentJobHandlers();
    vi.unstubAllEnvs();
  });
});
