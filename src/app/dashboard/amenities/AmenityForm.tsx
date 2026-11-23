'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { createAmenity } from '@/app/actions/amenities';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function AmenityForm({ properties }: { properties: { id: string; name: string }[] }) {
  const t = useTranslations('amenities');
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult<{ amenityId: string }> | null, FormData>(createAmenity, null);

  return (
    <details className="bg-white rounded-xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('form.open')}</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input id={`${id}-name`} name="name" maxLength={80} label={t('form.name')} required />
        <Select id={`${id}-property`} name="property_id" label={t('form.property')} required>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </Select>
        <Input id={`${id}-open`} name="open_time" type="time" defaultValue="08:00" label={t('form.openTime')} required />
        <Input id={`${id}-close`} name="close_time" type="time" defaultValue="22:00" label={t('form.closeTime')} required />
        <Input id={`${id}-slot`} name="slot_minutes" type="number" min={15} max={720} step={15} defaultValue="60" label={t('form.slotMinutes')} required />
        <Input id={`${id}-capacity`} name="capacity" type="number" min={1} max={500} label={t('form.capacity')} />
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" loading={pending}>{t('form.submit')}</Button>
          {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
          {state?.data && <p className="text-sm text-green-700">{t('form.saved')}</p>}
        </div>
      </form>
    </details>
  );
}
