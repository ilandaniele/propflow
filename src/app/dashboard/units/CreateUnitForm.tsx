'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createUnit } from '@/app/actions/properties';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createUnit');
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">{t('submit')}</Button>;
}

export function CreateUnitForm({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const t = useTranslations('forms.createUnit');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createUnit, {});

  if (state.data !== undefined && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{t('openButton')}</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create unit">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">{t('modalTitle')}</h2>
            <form action={action} className="space-y-4">
              <Select label="Property" name="property_id" required>
                <option value="">{t('selectProperty')}</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input label={t('unitLabelField')} name="label" required placeholder="e.g. Apt 3B" />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('floorLabel')} name="floor" placeholder="2" />
                <Input label={t('bedroomsLabel')} name="bedrooms" type="number" min="0" placeholder="2" />
              </div>
              <Input label={t('defaultRentLabel')} name="monthly_rent_default" type="number" min="0" step="0.01" placeholder="1500" />
              {/* toilet_type — admin-only; not shown in tenant portal */}
              <div className="flex flex-col gap-1">
                <label htmlFor="toilet_type" className="text-sm font-medium text-slate-700">
                  {t('bathroomLabel')}
                </label>
                <select
                  id="toilet_type"
                  name="toilet_type"
                  defaultValue="private"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="private">{t('privateBathroom')}</option>
                  <option value="shared">{t('sharedBathroom')}</option>
                  <option value="none">{t('noBathroom')}</option>
                </select>
              </div>
              {state.error && <p role="alert" className="text-sm text-red-600">{state.error.message}</p>}
              <div className="flex gap-2">
                <SubmitButton />
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
