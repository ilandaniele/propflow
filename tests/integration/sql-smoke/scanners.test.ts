/**
 * Real-SQL smoke test for src/lib/agent/voice/scanners.ts. `queueOutboundCall`
 * (src/lib/agent/voice/outbound.ts) is mocked — it pulls in the Vapi client,
 * compliance gate and session plumbing, none of which is under test here;
 * only the SQL eligibility queries are (see scanners.ts's own header on why
 * they're each one hand-written `db.execute(sql\`...\`)`).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createSmokeDb, seedOrg, seedAgentConfig, seedLead, seedVisit, seedProfile, seedCall, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const queueOutboundCall = vi.hoisted(() => vi.fn(async () => 'call-id'));
vi.mock('@/lib/agent/voice/outbound', () => ({ queueOutboundCall }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  queueOutboundCall.mockClear();
});

describe('voice scanners (real SQL)', () => {
  it('scanSpeedToLead queues an eligible fresh lead and skips one already called', async () => {
    const { db } = await import('@/lib/db');
    const { scanSpeedToLead } = await import('@/lib/agent/voice/scanners');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, {
      channelsEnabled: { whatsapp: false, web: false, voice: true },
      voiceConfig: { speedToLead: { enabled: true, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 } },
    });

    const now = new Date('2024-06-15T12:00:00Z');
    const eligible = await seedLead(typedDb, org.id, {
      pipeline: 'demand',
      phone: '+51987654321',
      doNotContact: false,
      sourceChannel: 'manual',
      createdAt: new Date(now.getTime() - 10 * 60_000),
    });
    // Already called (dedupe row exists) — must be excluded.
    const alreadyCalled = await seedLead(typedDb, org.id, {
      pipeline: 'demand',
      phone: '+51987654322',
      doNotContact: false,
      sourceChannel: 'manual',
      createdAt: new Date(now.getTime() - 10 * 60_000),
    });
    await seedCall(typedDb, org.id, {
      leadId: alreadyCalled.id,
      direction: 'outbound',
      purpose: 'speed_to_lead',
      dedupeKey: `stl:${alreadyCalled.id}`,
    });
    // Too fresh — inside the delayMinutes grace window.
    await seedLead(typedDb, org.id, {
      pipeline: 'demand',
      phone: '+51987654323',
      doNotContact: false,
      sourceChannel: 'manual',
      createdAt: new Date(now.getTime() - 30_000),
    });

    const queued = await scanSpeedToLead(now);

    expect(queued).toBe(1);
    expect(queueOutboundCall).toHaveBeenCalledTimes(1);
    expect(queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: org.id, leadId: eligible.id, purpose: 'speed_to_lead', dedupeKey: `stl:${eligible.id}` }),
    );
  });

  it('scanVisitConfirmationCalls queues a scheduled visit inside the confirmation window', async () => {
    const { db } = await import('@/lib/db');
    const { scanVisitConfirmationCalls } = await import('@/lib/agent/voice/scanners');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, {
      channelsEnabled: { whatsapp: false, web: false, voice: true },
      voiceConfig: { visitConfirmation: { enabled: true, hoursBefore: 20 } },
    });
    const advisor = await seedProfile(typedDb, org.id, { role: 'admin' });
    const lead = await seedLead(typedDb, org.id, { pipeline: 'demand' });

    const now = new Date('2024-06-15T12:00:00Z');
    const startsAt = new Date(now.getTime() + 10 * 3_600_000); // 10h from now — inside [3h, 20h]
    const visit = await seedVisit(typedDb, org.id, {
      leadId: lead.id,
      profileId: advisor.id,
      status: 'scheduled',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      blockedUntil: new Date(startsAt.getTime() + 60 * 60_000),
      sourceChannel: 'whatsapp',
      createdBy: 'agent',
      contactPhone: '+51987654321',
      createdAt: new Date(now.getTime() - 2 * 3_600_000), // booked 2h ago — past the 1h "just booked" guard
    });

    const queued = await scanVisitConfirmationCalls(now);

    expect(queued).toBe(1);
    expect(queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: org.id, leadId: lead.id, visitId: visit.id, purpose: 'visit_confirmation', dedupeKey: `vc:${visit.id}` }),
    );
  });

  it('scanReactivationCalls queues a cold open-stage lead', async () => {
    const { db } = await import('@/lib/db');
    const { scanReactivationCalls } = await import('@/lib/agent/voice/scanners');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await seedAgentConfig(typedDb, org.id, {
      channelsEnabled: { whatsapp: false, web: false, voice: true },
      voiceConfig: { reactivation: { enabled: true, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 } },
    });
    const lead = await seedLead(typedDb, org.id, {
      pipeline: 'demand',
      stage: 'new', // 'open' kind per SYSTEM_STAGES.demand
      doNotContact: false,
      phone: '+51987654321',
      intentTag: 'cold',
      followupState: 'idle',
    });

    const now = new Date('2024-06-15T12:00:00Z');
    const queued = await scanReactivationCalls(now);

    expect(queued).toBe(1);
    expect(queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: org.id, leadId: lead.id, purpose: 'reactivation' }),
    );
  });
});
