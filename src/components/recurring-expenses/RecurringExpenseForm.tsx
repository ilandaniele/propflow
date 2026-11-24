'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createRecurringExpense } from '@/app/actions/recurring-expenses';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';
import type { Option } from '@/lib/recurring-expenses/queries';

const SELECT_CLASS = 'h-9 w-full rounded border border-slate-300 px-2 text-sm';

type Props = { properties: Option[]; categories: Option[] };

export function RecurringExpenseForm({ properties, categories }: Props) {
  const t = useTranslations('recurringExpenses');
  const [state, action, pending] = useActionState<ActionResult, FormData>(createRecurringExpense, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <Input label={t('description')} name="description" required maxLength={500} />
      <Input label={t('amount')} name="amount" type="number" step="0.01" min="0.01" required />
      <Input label={t('day')} name="day_of_month" type="number" min="1" max="28" defaultValue="1" required />
      <div className="space-y-1">
        <label htmlFor="recurring_property" className="block text-sm font-medium text-slate-700">{t('property')}</label>
        <select id="recurring_property" name="property_id" defaultValue="" className={SELECT_CLASS}>
          <option value="">{t('none')}</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="recurring_category" className="block text-sm font-medium text-slate-700">{t('category')}</label>
        <select id="recurring_category" name="category_id" defaultValue="" className={SELECT_CLASS}>
          <option value="">{t('none')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('add')}</Button>
      {state.error && <p className="sm:col-span-3 text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
