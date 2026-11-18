/**
 * Real-SQL smoke test for src/lib/leads/followups.ts's
 * scheduleFollowupSequence — supersede + lead_followups + agent_jobs + lead
 * update, formerly a Postgres transaction, now one D1 batch (W-CF-32). Only
 * the agent config read is mocked, to pin the follow-up policy.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedLead, seedSession, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn(async () => ({
    timezone: 'America/Lima',
    followupPolicy: {
      enabled: true,
      steps: [{ afterMinutes: 120, kind: 'text' }, { afterMinutes: 1440, kind: 'template', template: 'seguimiento_lead' }],
      sendWindow: { startMinute: 0, endMinute: 1440 },
      listingAlerts: { enabled: false, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'propiedad_nueva' },
    },
  })),
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

describe('scheduleFollowupSequence (real SQL)', () => {
  it('schedules steps + jobs in one batch, is idempotent per anchor, and supersedes on re-anchor', async () => {
    const { scheduleFollowupSequence } = await import('@/lib/leads/followups');
    const org = await seedOrg(smoke.db);
    const lead = await seedLead(smoke.db, org.id);
    const session = await seedSession(smoke.db, org.id);
    const args = { orgId: org.id, leadId: lead.id, sessionId: session.id, anchorAt: new Date('2026-03-10T12:00:00Z') };

    expect(await scheduleFollowupSequence(args)).toBe(2);

    const followups = await smoke.db.select().from(schema.leadFollowups).where(eq(schema.leadFollowups.leadId, lead.id));
    expect(followups).toHaveLength(2);
    const jobs = await smoke.db.select().from(schema.agentJobs).where(eq(schema.agentJobs.orgId, org.id));
    expect(jobs.map((j) => (j.payload as { followupId: string }).followupId).sort())
      .toEqual(followups.map((f) => f.id).sort());
    const [activeLead] = await smoke.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(activeLead.followupState).toBe('active');
    expect(activeLead.nextFollowupAt).toBeInstanceOf(Date);

    expect(await scheduleFollowupSequence(args)).toBe(0);

    expect(await scheduleFollowupSequence({ ...args, anchorAt: new Date('2026-03-11T12:00:00Z') })).toBe(2);
    const superseded = await smoke.db.select().from(schema.leadFollowups).where(and(
      eq(schema.leadFollowups.leadId, lead.id),
      eq(schema.leadFollowups.sequenceAnchorAt, args.anchorAt),
    ));
    expect(superseded.map((f) => [f.status, f.stopReason])).toEqual([['cancelled', 'superseded'], ['cancelled', 'superseded']]);
  });
});
