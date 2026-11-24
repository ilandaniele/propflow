'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { cancelAmenityBooking } from '@/app/actions/amenities';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations('amenities');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(cancelAmenityBooking, null);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={bookingId} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>{t('cancel')}</Button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</span>}
    </form>
  );
}
