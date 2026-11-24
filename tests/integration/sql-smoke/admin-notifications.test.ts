import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', profileId: '', fail: false }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.fail) throw new Error('unauthorized');
    return { userId: auth.profileId, orgId: auth.orgId, role: 'admin', profile: { id: auth.profileId } };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const NOTICE = { type: 'receipt_pending', title: 'Receipt Pending Review', body: 'Review it', relatedType: 'payment_receipt' };

async function seedAdmins() {
  const org = await seedOrg(smoke.db);
  const first = await seedProfile(smoke.db, org.id, { email: 'a1@example.com' });
  const second = await seedProfile(smoke.db, org.id, { email: 'a2@example.com' });
  await seedProfile(smoke.db, org.id, { email: 't@example.com', role: 'tenant' });
  return { org, first, second };
}

function inboxOf(profileId: string) {
  return smoke.db.select().from(schema.notificationInbox).where(eq(schema.notificationInbox.profileId, profileId));
}

describe('admin notification inbox (real SQL)', () => {
  it('notifyOrgAdmins fans out to every admin of the org only', async () => {
    const { notifyOrgAdmins, adminInbox } = await import('@/lib/notifications/admin-inbox');
    const { org, first, second } = await seedAdmins();
    const otherOrg = await seedOrg(smoke.db);
    const outsider = await seedProfile(smoke.db, otherOrg.id, { email: 'x@example.com' });

    expect(await notifyOrgAdmins(org.id, NOTICE)).toBe(2);

    for (const admin of [first, second]) {
      const inbox = await adminInbox(org.id, admin.id);
      expect(inbox.unread).toBe(1);
      expect(inbox.items[0]).toMatchObject({ title: NOTICE.title, relatedType: 'payment_receipt', readAt: null });
    }
    expect(await inboxOf(outsider.id)).toHaveLength(0);
  });

  it('marks one notice, then all, without touching other admins', async () => {
    const { notifyOrgAdmins } = await import('@/lib/notifications/admin-inbox');
    const { markAdminNotificationsRead } = await import('@/app/actions/admin-notifications');
    const { org, first, second } = await seedAdmins();
    await notifyOrgAdmins(org.id, NOTICE);
    await notifyOrgAdmins(org.id, { ...NOTICE, title: 'Second' });
    auth.orgId = org.id;
    auth.profileId = first.id;
    auth.fail = false;

    const [target] = await inboxOf(first.id);
    const single = new FormData();
    single.set('notification_id', target.id);
    expect((await markAdminNotificationsRead(single)).error).toBeUndefined();
    let mine = await inboxOf(first.id);
    expect(mine.filter((n) => n.readAt).map((n) => n.id)).toEqual([target.id]);

    const [othersNotice] = await inboxOf(second.id);
    const foreign = new FormData();
    foreign.set('notification_id', othersNotice.id);
    expect((await markAdminNotificationsRead(foreign)).error).toBeUndefined();
    expect((await inboxOf(second.id)).every((n) => n.readAt === null)).toBe(true);

    expect((await markAdminNotificationsRead(new FormData())).error).toBeUndefined();
    mine = await inboxOf(first.id);
    expect(mine.every((n) => n.readAt !== null)).toBe(true);
    expect((await inboxOf(second.id)).every((n) => n.readAt === null)).toBe(true);
  });

  it('rejects an invalid id and unauthenticated callers', async () => {
    const { markAdminNotificationsRead } = await import('@/app/actions/admin-notifications');
    auth.fail = false;
    const bad = new FormData();
    bad.set('notification_id', 'not-a-guid');
    expect((await markAdminNotificationsRead(bad)).error?.code).toBe('VALIDATION_ERROR');

    auth.fail = true;
    expect((await markAdminNotificationsRead(new FormData())).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
