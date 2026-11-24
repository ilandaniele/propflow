'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { createAssetTask } from '@/app/actions/assets';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function TaskForm({ assetId, today }: { assetId: string; today: string }) {
  const t = useTranslations('assets.taskForm');
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult<{ taskId: string }> | null, FormData>(createAssetTask, null);

  return (
    <details className="bg-white rounded-xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('open')}</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="asset_id" value={assetId} />
        <Input id={`${id}-title`} name="title" maxLength={120} label={t('title')} required />
        <Input id={`${id}-frequency`} name="frequency_months" type="number" min={1} max={120} defaultValue="1" label={t('frequency')} required />
        <Input id={`${id}-starts`} name="starts_on" type="date" defaultValue={today} label={t('startsOn')} required />
        <Input id={`${id}-cost`} name="estimated_cost" type="number" min={0} step="0.01" label={t('estimatedCost')} />
        <Input id={`${id}-responsible`} name="responsible" maxLength={80} label={t('responsible')} />
        <Input id={`${id}-supplier`} name="supplier" maxLength={80} label={t('supplier')} />
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" loading={pending}>{t('submit')}</Button>
          {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
          {state?.data && <p className="text-sm text-green-700">{t('saved')}</p>}
        </div>
      </form>
    </details>
  );
}
