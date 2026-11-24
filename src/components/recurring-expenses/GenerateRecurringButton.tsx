'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { generateMonthRecurringExpenses } from '@/app/actions/recurring-expenses';
import { Button } from '@/components/ui/Button';
import type { ActionResult } from '@/lib/errors';

export function GenerateRecurringButton({ period }: { period: string }) {
  const t = useTranslations('recurringExpenses');
  const [state, action, pending] = useActionState<ActionResult<number>>(generateMonthRecurringExpenses, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>{pending ? t('generating') : t('generate', { period })}</Button>
      {state.data !== undefined && <span className="text-sm text-slate-600" role="status">{t('generated', { count: state.data })}</span>}
      {state.error && <span className="text-sm text-red-600" role="alert">{state.error.message}</span>}
    </form>
  );
}
