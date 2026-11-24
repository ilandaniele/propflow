'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateMonthlyStatements, type GenerateStatementsResult } from '@/app/actions/statements';

export function GenerateStatementsForm({ defaultMonth }: { defaultMonth: string }) {
  const t = useTranslations('accountStatements.generate');
  const [state, formAction, pending] = useActionState<GenerateStatementsResult | null, FormData>(generateMonthlyStatements, null);

  return (
    <form action={formAction} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">{t('title')}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{t('hint')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <Input id="statement-month" name="month" type="month" label={t('month')} defaultValue={defaultMonth} required />
        <Input id="statement-due-date" name="due_date" type="date" label={t('dueDate')} required />
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </div>
      {state?.error && <p role="alert" className="text-xs text-red-600">{state.error.message}</p>}
      {state?.data && <p role="status" className="text-xs text-green-700">{t('done', state.data)}</p>}
    </form>
  );
}
