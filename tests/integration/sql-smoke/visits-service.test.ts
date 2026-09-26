/**
 * Real-SQL smoke test for src/lib/agent/visits/service.ts's bookVisit —
 * specifically the `property_visits_no_overlap` EXCLUDE USING gist
 * constraint (0006_agent_visits.sql), which unit tests mocking `@/lib/db`
 * can never actually trigger since there's no real Postgres underneath to
 * raise 23P01.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, seedLead, seedAdvisorSettings, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

vi.mock('@/lib/agent/visits/hooks', () => ({ notifyVisitChanged: vi.fn() }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('bookVisit (real SQL)', () => {
  it('a second booking for the same advisor at an overlapping time is rejected with slot_taken via the EXCLUDE constraint', async () => {
    const { db } = await import('@/lib/db');
    const { bookVisit } = await import('@/lib/agent/visits/service');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const advisor = await seedProfile(typedDb, org.id, { role: 'admin' });
    await seedAdvisorSettings(typedDb, org.id, advisor.id, { acceptsVisits: true, bufferMinutes: 15 });
    const leadA = await seedLead(typedDb, org.id, { fullName: 'Lead A' });
    const leadB = await seedLead(typedDb, org.id, { fullName: 'Lead B' });

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days out — always in the future

    const first = await bookVisit({
      orgId: org.id,
      leadId: leadA.id,
      listingId: null,
      profileId: advisor.id,
      startsAt,
      visitMinutes: 45,
      contactPhone: '+51987654321',
      createdBy: 'agent',
      sourceChannel: 'whatsapp',
    });
    expect(first.ok).toBe(true);

    // Same advisor, a slot that overlaps once the post-visit buffer is
    // included (visit A blocks [15:00, 16:00) with a 15min buffer).
    const overlapping = await bookVisit({
      orgId: org.id,
      leadId: leadB.id,
      listingId: null,
      profileId: advisor.id,
      startsAt: new Date(startsAt.getTime() + 30 * 60_000),
      visitMinutes: 45,
      contactPhone: '+51987654322',
      createdBy: 'agent',
      sourceChannel: 'whatsapp',
    });
    expect(overlapping).toEqual({ ok: false, reason: 'slot_taken' });

    // A non-overlapping slot for the same advisor still succeeds.
    const later = await bookVisit({
      orgId: org.id,
      leadId: leadB.id,
      listingId: null,
      profileId: advisor.id,
      startsAt: new Date(startsAt.getTime() + 2 * 60 * 60_000),
      visitMinutes: 45,
      contactPhone: '+51987654322',
      createdBy: 'agent',
      sourceChannel: 'whatsapp',
    });
    expect(later.ok).toBe(true);
  });
});
