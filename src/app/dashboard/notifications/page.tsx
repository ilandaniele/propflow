import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { adminInbox } from '@/lib/notifications/admin-inbox';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarkReadButton } from './MarkReadButton';

export const metadata: Metadata = { title: 'Notifications' };

const RELATED_LINKS: Record<string, string> = {
  payment_receipt: '/dashboard/payments',
  payment: '/dashboard/payments',
};

export default async function AdminNotificationsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [inbox, t] = await Promise.all([adminInbox(ctx.orgId, ctx.profile.id), getTranslations('adminNotifications')]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('unread', { count: inbox.unread })}</p>
        </div>
        {inbox.unread > 0 && <MarkReadButton />}
      </div>

      {inbox.items.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <ul className="space-y-2">
          {inbox.items.map((item) => {
            const href = item.relatedType ? RELATED_LINKS[item.relatedType] : undefined;
            return (
              <li
                key={item.id}
                className={`rounded-lg border p-3 ${item.readAt ? 'border-slate-100 bg-white' : 'border-brand-200 bg-brand-50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${item.readAt ? 'text-slate-600' : 'text-slate-900'}`}>{item.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{item.body}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <time dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleString('es-PE')}</time>
                      {href && <Link href={href} className="text-brand-600 hover:underline">{t('open')}</Link>}
                    </div>
                  </div>
                  {!item.readAt && <MarkReadButton notificationId={item.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
