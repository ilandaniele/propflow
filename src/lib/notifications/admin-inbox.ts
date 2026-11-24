import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notificationInbox, profiles } from '@/lib/db/schema';

const MAX_ADMIN_RECIPIENTS = 50;
const INBOX_PAGE_SIZE = 100;

export interface AdminNotification {
  type: string;
  title: string;
  body: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

export async function notifyOrgAdmins(orgId: string, notification: AdminNotification): Promise<number> {
  const admins = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(MAX_ADMIN_RECIPIENTS);
  if (admins.length === 0) return 0;

  await db.insert(notificationInbox).values(admins.map((admin) => ({
    orgId,
    profileId: admin.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    relatedType: notification.relatedType ?? null,
    relatedId: notification.relatedId ?? null,
  })));
  return admins.length;
}

function ownInbox(orgId: string, profileId: string) {
  return and(eq(notificationInbox.orgId, orgId), eq(notificationInbox.profileId, profileId));
}

export async function adminInbox(orgId: string, profileId: string) {
  const [items, [unread]] = await Promise.all([
    db.select({
      id: notificationInbox.id,
      type: notificationInbox.type,
      title: notificationInbox.title,
      body: notificationInbox.body,
      relatedType: notificationInbox.relatedType,
      readAt: notificationInbox.readAt,
      createdAt: notificationInbox.createdAt,
    })
      .from(notificationInbox)
      .where(ownInbox(orgId, profileId))
      .orderBy(desc(notificationInbox.createdAt))
      .limit(INBOX_PAGE_SIZE),
    db.select({ total: count() })
      .from(notificationInbox)
      .where(and(ownInbox(orgId, profileId), isNull(notificationInbox.readAt))),
  ]);
  return { items, unread: unread?.total ?? 0 };
}

export async function markInboxRead(orgId: string, profileId: string, notificationId?: string): Promise<void> {
  const now = new Date();
  const scope = notificationId
    ? and(ownInbox(orgId, profileId), eq(notificationInbox.id, notificationId))
    : and(ownInbox(orgId, profileId), isNull(notificationInbox.readAt));
  await db.update(notificationInbox).set({ readAt: now, updatedAt: now }).where(scope);
}
