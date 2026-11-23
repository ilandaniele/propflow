'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { bookAmenity } from '@/app/actions/amenities';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function BookSlotForm({ amenityId, bookedOn, startTime, tenants }: {
  amenityId: string;
  bookedOn: string;
  startTime: string;
  tenants?: { id: string; name: string }[];
}) {
  const t = useTranslations('amenities');
  const [state, formAction, pending] = useActionState<ActionResult<{ bookingId: string }> | null, FormData>(bookAmenity, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="amenity_id" value={amenityId} />
      <input type="hidden" name="booked_on" value={bookedOn} />
      <input type="hidden" name="start_time" value={startTime} />
      {tenants && (
        <select
          name="tenant_id"
          aria-label={t('tenantLabel', { time: startTime })}
          className="max-w-48 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          defaultValue=""
        >
          <option value="">{t('noTenant')}</option>
          {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
      )}
      <Button type="submit" size="sm" loading={pending}>{t('book')}</Button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</span>}
    </form>
  );
}
