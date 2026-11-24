'use client';

import { useActionState, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adjustRent } from '@/app/actions/rent-adjustments';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { adjustedRent } from '@/lib/finance/rent-adjustment-math';
import { formatMoney } from '@/lib/finance/format-money';
import { Button } from '@/components/ui/Button';

type State = ActionResult<{ newRent: string }> | null;

interface Props {
  contractId: string;
  monthlyRent: number;
  defaultDate: string;
}

const fieldClasses = 'rounded-lg border border-slate-200 px-2 py-1 text-sm';

export function RentAdjustmentForm({ contractId, monthlyRent, defaultDate }: Props) {
  const t = useTranslations('rentAdjustments');
  const id = useId();
  const [percent, setPercent] = useState('');
  const [state, formAction, pending] = useActionState<State, FormData>(adjustRent, null);

  if (state?.data) {
    return <span className="text-xs text-green-700">{t('done', { rent: formatMoney(Number(state.data.newRent)) })}</span>;
  }

  const preview = Number(percent) ? formatMoney(adjustedRent(monthlyRent, Number(percent))) : null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="contract_id" value={contractId} />
      <label htmlFor={`${id}-percent`} className="sr-only">{t('percent')}</label>
      <input
        id={`${id}-percent`}
        name="percent"
        type="number"
        step="0.01"
        min="-50"
        max="100"
        required
        placeholder="%"
        value={percent}
        onChange={(event) => setPercent(event.target.value)}
        className={`w-20 ${fieldClasses}`}
      />
      <label htmlFor={`${id}-date`} className="sr-only">{t('effectiveOn')}</label>
      <input id={`${id}-date`} name="effective_on" type="date" required defaultValue={defaultDate} className={fieldClasses} />
      <Button type="submit" size="sm" loading={pending}>{t('submit')}</Button>
      {preview && <span className="text-xs text-slate-500">{t('preview', { rent: preview })}</span>}
      {state?.error && (
        <span role="alert" className="text-xs text-red-600">
          {state.error.code === 'NOT_ACTIVE' ? t('notActive') : actionErrorMessage(state.error)}
        </span>
      )}
    </form>
  );
}
