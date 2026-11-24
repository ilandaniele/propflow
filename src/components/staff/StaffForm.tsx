'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { addStaffMember } from '@/app/actions/staff';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('staff');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('add')}</Button>;
}

export function StaffForm({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const t = useTranslations('staff');
  const [state, action] = useActionState<ActionResult, FormData>(addStaffMember, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
      <Input label={t('fullNameLabel')} name="full_name" required maxLength={200} />
      <Input label={t('positionLabel')} name="position" required maxLength={100} placeholder={t('positionPlaceholder')} />
      <Input label={t('shiftLabel')} name="shift" maxLength={100} placeholder={t('shiftPlaceholder')} />
      <Input label={t('phoneLabel')} name="phone" maxLength={30} />
      <Input label={t('documentLabel')} name="document_number" maxLength={30} />
      <div className="space-y-1">
        <label htmlFor="staff_property_id" className="block text-sm font-medium text-slate-700">{t('propertyLabel')}</label>
        <select id="staff_property_id" name="property_id" defaultValue="" className="h-9 w-full rounded border border-slate-300 px-2 text-sm">
          <option value="">{t('allProperties')}</option>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
        <SubmitButton />
        {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
      </div>
    </form>
  );
}
