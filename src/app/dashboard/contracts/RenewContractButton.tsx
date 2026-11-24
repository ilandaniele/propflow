'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { renewContract } from '@/app/actions/contracts';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

type State = ActionResult<{ contractId: string }> | null;

export function RenewContractButton({ contractId, monthlyRent }: { contractId: string; monthlyRent: number }) {
  const t = useTranslations('contracts.renew');
  const id = useId();
  const [state, formAction, pending] = useActionState<State, FormData>(renewContract, null);

  if (state?.data) return <span className="text-xs text-green-700">{t('done')}</span>;

  return (
    <details className="relative">
      <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline list-none">{t('open')}</summary>
      <form action={formAction} className="absolute right-0 z-10 mt-2 w-64 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <input type="hidden" name="contract_id" value={contractId} />
        <Input id={`${id}-months`} name="months" type="number" min="1" max="60" defaultValue="12" label={t('months')} required />
        <Input id={`${id}-rent`} name="monthly_rent" type="number" step="0.01" min="0.01" defaultValue={monthlyRent.toFixed(2)} label={t('rent')} hint={t('hint')} />
        {state?.error && (
          <p role="alert" className="text-xs text-red-600">
            {state.error.code === 'NOT_ACTIVE' ? t('notActive') : actionErrorMessage(state.error)}
          </p>
        )}
        <Button type="submit" loading={pending} className="w-full">{t('submit')}</Button>
      </form>
    </details>
  );
}
