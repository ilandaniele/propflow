'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createUnitBed } from '@/app/actions/unit-beds';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export function UnitBedForm({ unitId }: { unitId: string }) {
  const t = useTranslations('unitBeds');
  const [state, action, pending] = useActionState<ActionResult, FormData>(createUnitBed, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="unit_id" value={unitId} />
      <Input id="unit_bed_label" label={t('label')} name="label" required maxLength={40} />
      <Input id="unit_bed_rent" label={t('rent')} name="monthly_rent" type="number" min={0} step="0.01" />
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('add')}</Button>
      {state.error && <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
