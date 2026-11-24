import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

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

describe('activity feed (real SQL)', () => {
  it('records events and lists them newest first, scoped by org and date range', async () => {
    const { recordActivity } = await import('@/lib/activity/record');
    const { listActivity } = await import('@/lib/activity/queries');
    const { resolveActivityRange } = await import('@/lib/activity/filters');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const admin = await seedProfile(smoke.db, org.id, { email: `a-${crypto.randomUUID()}@example.com` });

    await recordActivity({ orgId: org.id, actorId: admin.id, action: 'expense_recorded', resourceType: 'expense', summary: 'x'.repeat(300) });
    await smoke.db.insert(schema.activityEvents).values([
      { orgId: org.id, actorId: admin.id, action: 'incident_resolved', resourceType: 'incident', createdAt: new Date('2026-01-15T12:00:00Z') },
      { orgId: other.id, action: 'announcement_published', resourceType: 'announcement' },
    ]);

    const all = await listActivity(org.id);
    expect(all.map((e) => e.action)).toEqual(['expense_recorded', 'incident_resolved']);
    expect(all[0].summary).toHaveLength(200);

    const january = await listActivity(org.id, resolveActivityRange({ from: '2026-01-01', to: '2026-01-31' }));
    expect(january.map((e) => e.action)).toEqual(['incident_resolved']);
  });

  it('swallows insert failures instead of breaking the caller', async () => {
    const { recordActivity } = await import('@/lib/activity/record');
    await expect(recordActivity({ orgId: 'missing-org', actorId: 'missing', action: 'cleaning_scheduled', resourceType: 'cleaning_task' }))
      .resolves.toBeUndefined();
  });
});
