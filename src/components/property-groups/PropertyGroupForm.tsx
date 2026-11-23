'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createPropertyGroup } from '@/app/actions/property-groups';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

type Props = { properties: { id: string; name: string }[] };

export function PropertyGroupForm({ properties }: Props) {
  const t = useTranslations('propertyGroups');
  const [state, action, pending] = useActionState<ActionResult, FormData>(createPropertyGroup, {});

  return (
    <form action={action} className="space-y-3">
      <Input id="property_group_name" label={t('name')} name="name" required maxLength={100} />
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="text-sm font-medium text-slate-700 mb-1">{t('members')}</legend>
        {properties.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="property_ids" value={p.id} />
            {p.name}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('create')}</Button>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
