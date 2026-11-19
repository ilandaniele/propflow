/**
 * Real-SQL smoke test for src/lib/leads/routing.ts's routeLead — the
 * assigned_count compare-and-set cursor plus the round-robin/weighted
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
  it('round_robin assigns to the advisor with the fewest recent assignments', async () => {
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

  it('two concurrent round_robin calls land on different advisors', async () => {
    const { db } = await import('@/lib/db');
    const { routeLead } = await import('@/lib/leads/routing');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, { routingMode: 'round_robin' });
    const advisorA = await seedProfile(typedDb, org.id, { role: 'admin', fullName: 'Advisor A' });
    const advisorB = await seedProfile(typedDb, org.id, { role: 'admin', fullName: 'Advisor B' });
    for (const advisor of [advisorA, advisorB]) {
      await typedDb.insert(schema.leadRoutingMembers).values({
        orgId: org.id,
        profileId: advisor.id,
        pipeline: 'both',
        active: true,
        lastAssignedAt: null,
      });
    }
    const lead1 = await seedLead(typedDb, org.id, { pipeline: 'demand' });
    const lead2 = await seedLead(typedDb, org.id, { pipeline: 'demand' });

    const [r1, r2] = await Promise.all([
      routeLead({ orgId: org.id, leadId: lead1.id }),
      routeLead({ orgId: org.id, leadId: lead2.id }),
    ]);

    expect(r1.profileId).not.toBeNull();
    expect(r2.profileId).not.toBeNull();
    expect(new Set([r1.profileId, r2.profileId])).toEqual(new Set([advisorA.id, advisorB.id]));
  });
});

describe('assignLeadManually (real SQL)', () => {
  it('assigns, then reassigns, writing one lead_assignments row per change', async () => {
    const { assignLeadManually } = await import('@/lib/leads/routing');
    const org = await seedOrg(smoke.db);
    const actor = await seedProfile(smoke.db, org.id, { role: 'admin', fullName: 'Actor' });
    const advisor = await seedProfile(smoke.db, org.id, { role: 'admin', fullName: 'Advisor' });
    const lead = await seedLead(smoke.db, org.id, { pipeline: 'demand' });

    expect(await assignLeadManually({ orgId: org.id, leadId: lead.id, profileId: advisor.id, actorProfileId: actor.id }))
      .toEqual({ ok: true });
    expect(await assignLeadManually({ orgId: org.id, leadId: lead.id, profileId: actor.id, actorProfileId: actor.id }))
      .toEqual({ ok: true });

    const [updatedLead] = await smoke.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(updatedLead.assignedProfileId).toBe(actor.id);
    const history = await smoke.db.select().from(schema.leadAssignments).where(eq(schema.leadAssignments.leadId, lead.id));
    expect(history.map((h) => [h.method, h.previousProfileId, h.profileId]).sort()).toEqual([
      ['manual', null, advisor.id],
      ['reassign', advisor.id, actor.id],
    ]);
  });
});
