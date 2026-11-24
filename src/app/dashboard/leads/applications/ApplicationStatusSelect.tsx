'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updateRentalApplicationStatus } from '@/app/actions/rental-application';
import { APPLICATION_STATUSES } from '@/lib/schemas/rental-application';

export function ApplicationStatusSelect({ applicationId, status }: { applicationId: string; status: string }) {
  const t = useTranslations('rentalApplications');
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const formData = new FormData();
    formData.set('application_id', applicationId);
    formData.set('status', next);
    startTransition(async () => { await updateRentalApplicationStatus(formData); });
  }

  return (
    <select
      aria-label={t('statusLabel')}
      defaultValue={status}
      disabled={pending}
      onChange={(event) => change(event.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-50"
    >
      {APPLICATION_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
    </select>
  );
}
