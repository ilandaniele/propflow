import { getTranslations } from 'next-intl/server';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPortalPreviewNotifications } from '@/lib/portal-preview/queries';

const BODY_PREVIEW_LENGTH = 80;

interface Props {
  profileId: string | null;
  orgId: string;
}

/**
 * Async Server Component — read-only list of notification_inbox rows for this tenant.
 * If profileId is null (no portal account linked), renders an empty-state note instead
 * of querying the DB (IC5). Uses the AC8-compliant helper.
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function NotificationsSection({ profileId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');
  const supabase = await createClient();

  // getPortalPreviewNotifications returns [] immediately when profileId is null (IC5)
  const notifications = await getPortalPreviewNotifications(supabase, profileId, ctx.orgId);

  return (
    <Card data-testid="portal-preview-notifications">
      <CardHeader>
        <CardTitle>{t('portalPreview.sections.notifications')}</CardTitle>
      </CardHeader>

      {profileId === null ? (
        <p className="text-sm text-slate-400 italic">{t('portalPreview.notifications.noAccount')}</p>
      ) : notifications.length === 0 ? (
        <p className="text-sm text-slate-400">{t('portalPreview.notifications.empty')}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {notifications.map((n) => (
            <div key={n.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 text-sm">{n.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                  {n.body.slice(0, BODY_PREVIEW_LENGTH)}{n.body.length > BODY_PREVIEW_LENGTH ? '…' : ''}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {t('portalPreview.notifications.sentAt')}: {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              <span
                className={[
                  'shrink-0 text-xs font-medium px-2 py-0.5 rounded-full',
                  n.read_at
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-blue-50 text-blue-700',
                ].join(' ')}
              >
                {n.read_at
                  ? t('portalPreview.notifications.read')
                  : t('portalPreview.notifications.unread')}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
