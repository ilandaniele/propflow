/**
 * Durable job queue for the real-estate agent (reminders, follow-ups,
 * calendar sync, outbound calls). Claimed with FOR UPDATE SKIP LOCKED so
 * multiple drainers (instrumentation interval + cron backstop) never
 * double-process the same job.
 *
 * Job kinds are registered by later phases via registerAgentJobHandler();
 * Phase 0 ships the queue plumbing only — no job kinds exist yet.
 */

import { db } from '@/lib/db';
import { agentJobs } from '@/lib/db/schema';
import { and, eq, lte, or, isNull, inArray } from 'drizzle-orm';
import { log } from '@/lib/log';

export type AgentJobHandler = (payload: Record<string, unknown>, orgId: string) => Promise<void>;

const HANDLERS = new Map<string, AgentJobHandler>();

/** Register a handler for a job kind. Later phases call this once at module load. */
export function registerAgentJobHandler(kind: string, handler: AgentJobHandler): void {
  HANDLERS.set(kind, handler);
}

const CLAIM_LOCK_MS = 2 * 60 * 1000; // 2 minutes — long enough for a Fly resume + a Claude call
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]; // per attempt

export interface EnqueueJobArgs {
  orgId: string;
  kind: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
}

export async function enqueueJob({ orgId, kind, payload = {}, runAt }: EnqueueJobArgs): Promise<string> {
  const rows = await db
    .insert(agentJobs)
    .values({ orgId, kind, payload, runAt: runAt ?? new Date() })
    .returning({ id: agentJobs.id });

  return rows[0].id;
}

interface ClaimedJob {
  id: string;
  orgId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Claim up to `limit` due jobs, marking them 'processing' with a lock, in one transaction. */
async function claimDueJobs(limit: number): Promise<ClaimedJob[]> {
  return db.transaction(async (tx) => {
    const now = new Date();

    const due = await tx
      .select({
        id: agentJobs.id,
        orgId: agentJobs.orgId,
        kind: agentJobs.kind,
        payload: agentJobs.payload,
        attempts: agentJobs.attempts,
      })
      .from(agentJobs)
      .where(and(
        eq(agentJobs.status, 'pending'),
        lte(agentJobs.runAt, now),
        or(isNull(agentJobs.lockedUntil), lte(agentJobs.lockedUntil, now)),
      ))
      .orderBy(agentJobs.runAt)
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    await tx
      .update(agentJobs)
      .set({ status: 'processing', lockedUntil: new Date(now.getTime() + CLAIM_LOCK_MS), updatedAt: now })
      .where(inArray(agentJobs.id, due.map((j) => j.id)));

    return due as ClaimedJob[];
  });
}

async function completeJob(id: string): Promise<void> {
  await db.update(agentJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(agentJobs.id, id));
}

async function retryOrFailJob(job: ClaimedJob, error: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);

  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(agentJobs)
      .set({ status: 'failed', attempts, lastError: message, lockedUntil: null, updatedAt: new Date() })
      .where(eq(agentJobs.id, job.id));
    log.error('[agent:jobs] job exhausted retries', { jobId: job.id, kind: job.kind, attempts });
    return;
  }

  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
  await db
    .update(agentJobs)
    .set({
      status: 'pending',
      attempts,
      lastError: message,
      runAt: new Date(Date.now() + delay),
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(agentJobs.id, job.id));
}

/** Claim and process due jobs. Safe to call concurrently and on an interval. */
export async function drainAgentJobs(limit = 20): Promise<{ processed: number; failed: number }> {
  const jobs = await claimDueJobs(limit);
  let failed = 0;

  for (const job of jobs) {
    const handler = HANDLERS.get(job.kind);
    if (!handler) {
      await retryOrFailJob(job, new Error(`no handler registered for kind "${job.kind}"`));
      failed++;
      continue;
    }
    try {
      await handler(job.payload, job.orgId);
      await completeJob(job.id);
    } catch (e) {
      await retryOrFailJob(job, e);
      failed++;
    }
  }

  return { processed: jobs.length, failed };
}
