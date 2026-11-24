'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { markAdminNotificationsRead } from '@/app/actions/admin-notifications';

export function MarkReadButton({ notificationId }: { notificationId?: string }) {
  const t = useTranslations('adminNotifications');
  const [pending, startTransition] = useTransition();

  function markRead() {
    const formData = new FormData();
    if (notificationId) formData.set('notification_id', notificationId);
    startTransition(async () => { await markAdminNotificationsRead(formData); });
  }

  return (
    <button
      type="button"
      onClick={markRead}
      disabled={pending}
      className="text-xs text-brand-600 hover:underline disabled:opacity-50 shrink-0"
    >
      {pending ? '…' : notificationId ? t('markRead') : t('markAllRead')}
    </button>
  );
}
