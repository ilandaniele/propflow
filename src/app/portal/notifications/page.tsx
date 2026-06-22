import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { notificationInbox } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationMarkReadButton } from './NotificationMarkReadButton';

export default async function PortalNotificationsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const notifications = await db
    .select({
      id:        notificationInbox.id,
      type:      notificationInbox.type,
      title:     notificationInbox.title,
      body:      notificationInbox.body,
      readAt:    notificationInbox.readAt,
      createdAt: notificationInbox.createdAt,
    })
    .from(notificationInbox)
    .where(and(eq(notificationInbox.profileId, ctx.userId), eq(notificationInbox.orgId, ctx.orgId)))
    .orderBy(desc(notificationInbox.createdAt))
    .limit(50);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" description="Payment reminders and announcements will appear here." />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`border rounded-lg p-3 ${n.readAt ? 'border-slate-100 bg-white opacity-70' : 'border-brand-200 bg-brand-50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${n.readAt ? 'text-slate-600' : 'text-slate-900'}`}>{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : '—'}
                  </p>
                </div>
                {!n.readAt && <NotificationMarkReadButton notificationId={n.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
