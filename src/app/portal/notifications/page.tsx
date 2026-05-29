import { requireTenant } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationMarkReadButton } from './NotificationMarkReadButton';

export default async function PortalNotificationsPage() {
  const ctx = await requireTenant();
  const supabase = await createClient();

  // Owner-scoped by RLS
  const { data: notifications } = await supabase
    .from('notification_inbox')
    .select('id, type, title, body, read_at, created_at')
    .eq('profile_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>

      {(notifications ?? []).length === 0 ? (
        <EmptyState title="No notifications" description="Payment reminders and announcements will appear here." />
      ) : (
        <div className="space-y-2">
          {(notifications ?? []).map((n) => (
            <div
              key={n.id}
              className={`border rounded-lg p-3 ${n.read_at ? 'border-slate-100 bg-white opacity-70' : 'border-brand-200 bg-brand-50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${n.read_at ? 'text-slate-600' : 'text-slate-900'}`}>{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                  <p className="text-xs text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.read_at && <NotificationMarkReadButton notificationId={n.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
