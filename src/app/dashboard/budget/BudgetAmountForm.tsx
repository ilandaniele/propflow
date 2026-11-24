'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setExpenseBudget } from '@/app/actions/budget';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function BudgetAmountForm({ categoryId, year, amount, label }: {
  categoryId: string;
  year: number;
  amount: number;
  label: string;
}) {
  const t = useTranslations('budget');
  const [state, formAction, pending] = useActionState<ActionResult<{ saved: true }> | null, FormData>(setExpenseBudget, null);

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="year" value={year} />
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0"
        defaultValue={amount ? amount.toFixed(2) : ''}
        aria-label={t('amountLabel', { category: label })}
        className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
        required
      />
      <Button type="submit" size="sm" loading={pending}>{t('save')}</Button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</span>}
      {state?.data && <span className="text-xs text-green-700">{t('saved')}</span>}
    </form>
  );
}
