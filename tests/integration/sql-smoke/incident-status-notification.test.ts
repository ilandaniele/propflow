import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (!authBox.ctx) throw new Error('unauthorized');
    return authBox.ctx;
  },
  requireUser: async () => {
    throw new Error('unused');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const { updateIncident } = await import('@/app/actions/incidents');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  authBox.ctx = null;
});

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function seedIncident(db: SmokeDb, withProfile: boolean) {
  const org = await seedOrg(db);
  const profile = await seedProfile(db, org.id, { role: 'tenant', email: null });
  const [tenant] = await db.insert(schema.tenants)
    .values({ orgId: org.id, fullName: 'Tenant', profileId: withProfile ? profile.id : null })
    .returning();
  const [incident] = await db.insert(schema.incidents)
    .values({ orgId: org.id, tenantId: tenant.id, title: 'Fuga de agua', description: 'Baño', category: 'plumbing', status: 'pending' })
    .returning();
  return { org, profile, incident };
}

async function inbox(db: SmokeDb, profileId: string) {
  return db.select().from(schema.notificationInbox).where(eq(schema.notificationInbox.profileId, profileId));
}

describe('updateIncident status notification', () => {
  it('notifies the tenant once per real status change', async () => {
    const { db } = smoke;
    const { org, profile, incident } = await seedIncident(db, true);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await updateIncident({}, form({ id: incident.id, status: 'in_progress' }))).error).toBeUndefined();
    expect((await updateIncident({}, form({ id: incident.id, status: 'in_progress' }))).error).toBeUndefined();
    expect((await updateIncident({}, form({ id: incident.id, priority: 'high' }))).error).toBeUndefined();

    const rows = await inbox(db, profile.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: org.id,
      type: 'incident_status',
      title: 'title.in_progress',
      relatedType: 'incident',
      relatedId: incident.id,
    });
    expect(rows[0].body).toContain('Fuga de agua');

    expect((await updateIncident({}, form({ id: incident.id, status: 'solved' }))).error).toBeUndefined();
    expect(await inbox(db, profile.id)).toHaveLength(2);
    const [updated] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incident.id));
    expect(updated.status).toBe('solved');
    expect(updated.resolvedAt).toBeInstanceOf(Date);
  });

  it('skips the notification when the tenant has no portal profile', async () => {
    const { db } = smoke;
    const { org, profile, incident } = await seedIncident(db, false);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await updateIncident({}, form({ id: incident.id, status: 'solved' }))).error).toBeUndefined();
    expect(await inbox(db, profile.id)).toHaveLength(0);
  });

  it('does not touch or notify across orgs', async () => {
    const { db } = smoke;
    const { profile, incident } = await seedIncident(db, true);
    const other = await seedOrg(db, { name: 'Other' });
    authBox.ctx = { userId: crypto.randomUUID(), orgId: other.id };

    expect((await updateIncident({}, form({ id: incident.id, status: 'solved' }))).error?.code).toBe('NOT_FOUND');
    expect(await inbox(db, profile.id)).toHaveLength(0);
  });
});
