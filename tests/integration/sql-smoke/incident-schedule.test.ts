import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: 'admin-1', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx), requireUser: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateIncident } from '@/app/actions/incidents';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedIncident() {
  const org = await seedOrg(db);
  const [incident] = await db.insert(schema.incidents).values({
    orgId: org.id, category: 'plumbing', title: 'Fuga', description: 'Fuga en baño',
  }).returning();
  return incident;
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const scheduleOf = (incidentId: string) =>
  db.select().from(schema.incidentSchedules).where(eq(schema.incidentSchedules.incidentId, incidentId));

describe('incident estimated date (real SQL)', () => {
  it('sets, changes and clears the estimated date', async () => {
    const incident = await seedIncident();
    auth.ctx.orgId = incident.orgId;

    expect((await updateIncident({}, form({ id: incident.id, status: 'in_progress', estimated_on: '2026-12-01' }))).error).toBeUndefined();
    expect((await scheduleOf(incident.id))[0]).toMatchObject({ orgId: incident.orgId, estimatedOn: '2026-12-01' });

    await updateIncident({}, form({ id: incident.id, estimated_on: '2026-12-15' }));
    await updateIncident({}, form({ id: incident.id, estimated_on: '' }));
    const rows = await scheduleOf(incident.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedOn).toBeNull();

    const [updated] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incident.id));
    expect(updated.status).toBe('in_progress');
  });

  it('leaves the schedule alone when the field is not sent', async () => {
    const incident = await seedIncident();
    auth.ctx.orgId = incident.orgId;

    await updateIncident({}, form({ id: incident.id, priority: 'high' }));
    expect(await scheduleOf(incident.id)).toHaveLength(0);
  });

  it('refuses incidents of another org and malformed dates', async () => {
    const incident = await seedIncident();
    const other = await seedOrg(db);
    auth.ctx.orgId = other.id;

    expect((await updateIncident({}, form({ id: incident.id, estimated_on: '2026-12-01' }))).error?.code).toBe('NOT_FOUND');
    auth.ctx.orgId = incident.orgId;
    expect((await updateIncident({}, form({ id: incident.id, estimated_on: '01/12/2026' }))).error?.code).toBe('VALIDATION_ERROR');
    expect(await scheduleOf(incident.id)).toHaveLength(0);
  });
});
