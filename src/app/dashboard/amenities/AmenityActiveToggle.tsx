'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setAmenityActive } from '@/app/actions/amenities';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function AmenityActiveToggle({ amenityId, active }: { amenityId: string; active: boolean }) {
  const t = useTranslations('amenities');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(setAmenityActive, null);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={amenityId} />
      <input type="hidden" name="active" value={String(!active)} />
      <Button type="submit" size="sm" variant="ghost" loading={pending}>{active ? t('deactivate') : t('activate')}</Button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</span>}
    </form>
  );
}
