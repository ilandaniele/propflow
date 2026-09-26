/**
 * Real-SQL smoke test for src/lib/leads/routing.ts's routeLead — the
 * `pg_advisory_xact_lock(hashtext(...))` call plus the round-robin/weighted
 * assignment queries. notifyAdvisorLeadAssigned is mocked (notifications are
 * out of scope for a SQL smoke test).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProfile, seedLead, seedAgentConfig, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

vi.mock('@/lib/leads/notify-advisor', () => ({ notifyAdvisorLeadAssigned: vi.fn(async () => {}) }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('routeLead (real SQL)', () => {
  it('round_robin assigns to the advisor with the fewest recent assignments, guarded by pg_advisory_xact_lock(hashtext(...))', async () => {
    const { db } = await import('@/lib/db');
    const { routeLead } = await import('@/lib/leads/routing');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, { routingMode: 'round_robin' });

    const advisorA = await seedProfile(typedDb, org.id, { role: 'admin', fullName: 'Advisor A' });
    const advisorB = await seedProfile(typedDb, org.id, { role: 'admin', fullName: 'Advisor B' });

    // A already has a recent assignment; B has never been assigned — B wins
    // (null lastAssignedAt sorts first).
    await typedDb.insert(schema.leadRoutingMembers).values({
      orgId: org.id,
      profileId: advisorA.id,
      pipeline: 'both',
      active: true,
      lastAssignedAt: new Date(),
    });
    await typedDb.insert(schema.leadRoutingMembers).values({
      orgId: org.id,
      profileId: advisorB.id,
      pipeline: 'both',
      active: true,
      lastAssignedAt: null,
    });

    const lead = await seedLead(typedDb, org.id, { pipeline: 'demand' });

    const result = await routeLead({ orgId: org.id, leadId: lead.id });

    expect(result).toEqual({ profileId: advisorB.id, method: 'round_robin' });

    const [updatedLead] = await typedDb.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(updatedLead.assignedProfileId).toBe(advisorB.id);

    // A second call is a no-op — the lead is already assigned.
    const second = await routeLead({ orgId: org.id, leadId: lead.id });
    expect(second).toEqual({ profileId: null, method: null });
  });
});
