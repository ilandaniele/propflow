'use client';

import { useTransition } from 'react';
import { markNotificationRead } from '@/app/actions/ops';

export function NotificationMarkReadButton({ notificationId }: { notificationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        const formData = new FormData();
        formData.set('notification_id', notificationId);
        startTransition(async () => { await markNotificationRead({}, formData); });
      }}
      disabled={isPending}
      className="text-xs text-brand-600 hover:underline disabled:opacity-50 shrink-0"
    >
      {isPending ? '…' : 'Mark read'}
    </button>
  );
}
