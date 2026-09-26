/**
 * Real-SQL smoke test for src/lib/agent/qa-export.ts's collectQaRows (a
 * multi-join, multi-condition `or(eq(...), and(eq(...), sql\`...\`))` query)
 * and toCsv (pure formatting, exercised here with rows collectQaRows
 * actually produced).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  createSmokeDb,
  seedOrg,
  seedProfile,
  seedSession,
  seedEvent,
  seedLead,
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

describe('qa-export (real SQL)', () => {
  it('collectQaRows finds handoff + manual-takeover events in range, joined to lead/advisor, and toCsv renders them', async () => {
    const { db } = await import('@/lib/db');
    const { collectQaRows, toCsv } = await import('@/lib/agent/qa-export');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const advisor = await seedProfile(typedDb, org.id, { role: 'admin', fullName: 'Ana Advisor' });
    const lead = await seedLead(typedDb, org.id, { fullName: 'Lead Uno', phone: '+51987654321', assignedProfileId: advisor.id });
    const session = await seedSession(typedDb, org.id, { leadId: lead.id, channel: 'whatsapp', agentTurnCount: 4 });

    const from = new Date('2024-06-01T00:00:00Z');
    const to = new Date('2024-06-08T00:00:00Z');
    const inRange = new Date('2024-06-03T10:00:00Z');

    await seedEvent(typedDb, org.id, session.id, {
      kind: 'handoff',
      data: { reason: 'complaint', summary: 'Cliente molesto' },
      createdAt: inRange,
    });
    await seedEvent(typedDb, org.id, session.id, {
      kind: 'mode_change',
      data: { to: 'human' },
      createdAt: new Date(inRange.getTime() + 60_000),
    });
    // Outside the range — must not appear.
    await seedEvent(typedDb, org.id, session.id, { kind: 'handoff', data: { reason: 'complaint' }, createdAt: new Date('2024-05-01T00:00:00Z') });
    // A mode_change that ISN'T a handoff to human — must not appear.
    await seedEvent(typedDb, org.id, session.id, { kind: 'mode_change', data: { to: 'ai' }, createdAt: inRange });

    const rows = await collectQaRows(org.id, from, to);

    expect(rows).toHaveLength(2);
    const handoffRow = rows.find((r) => r.kind === 'handoff');
    const takeoverRow = rows.find((r) => r.kind === 'takeover');
    expect(handoffRow?.isComplaint).toBe(true);
    expect(handoffRow?.leadName).toBe('Lead Uno');
    expect(handoffRow?.advisorName).toBe('Ana Advisor');
    expect(takeoverRow?.reason).toBe('manual_takeover');
    expect(takeoverRow?.isComplaint).toBe(false);

    const csv = toCsv(rows, 'UTC');
    expect(csv.startsWith('﻿occurred_at,')).toBe(true);
    expect(csv).toContain('Lead Uno');
    expect(csv).toContain('true'); // is_complaint column for the handoff row
  });
});
