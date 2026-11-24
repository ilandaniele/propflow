'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { createAsset } from '@/app/actions/assets';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { ASSET_CATEGORIES } from '@/lib/schemas/asset';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function AssetForm({ properties }: { properties: { id: string; name: string }[] }) {
  const t = useTranslations('assets');
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult<{ assetId: string }> | null, FormData>(createAsset, null);

  return (
    <details className="bg-white rounded-xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('form.open')}</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input id={`${id}-name`} name="name" maxLength={80} label={t('form.name')} required />
        <Select id={`${id}-property`} name="property_id" label={t('form.property')} required>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </Select>
        <Select id={`${id}-category`} name="category" label={t('form.category')} required>
          {ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{t(`categories.${category}`)}</option>)}
        </Select>
        <Input id={`${id}-location`} name="location" maxLength={120} label={t('form.location')} />
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" loading={pending}>{t('form.submit')}</Button>
          {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
          {state?.data && <p className="text-sm text-green-700">{t('form.saved')}</p>}
        </div>
      </form>
    </details>
  );
}
