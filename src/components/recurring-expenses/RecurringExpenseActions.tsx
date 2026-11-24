'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { removeRecurringExpense, toggleRecurringExpense } from '@/app/actions/recurring-expenses';
import type { ActionResult } from '@/lib/errors';

export function RecurringExpenseActions({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations('recurringExpenses');
  const [toggleState, toggle, toggling] = useActionState<ActionResult, FormData>(toggleRecurringExpense, {});
  const [removeState, remove, removing] = useActionState<ActionResult, FormData>(removeRecurringExpense, {});
  const error = toggleState.error ?? removeState.error;

  return (
    <div className="flex items-center gap-3">
      <form action={toggle}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={String(!active)} />
        <button type="submit" disabled={toggling} className="text-sm text-brand-600 hover:underline disabled:opacity-50">
          {active ? t('pause') : t('resume')}
        </button>
      </form>
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={removing} className="text-sm text-red-600 hover:underline disabled:opacity-50">{t('remove')}</button>
      </form>
      {error && <span className="text-xs text-red-600" role="alert">{error.message}</span>}
    </div>
  );
}
