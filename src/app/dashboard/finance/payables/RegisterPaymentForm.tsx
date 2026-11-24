'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { registerPayablePayment } from '@/app/actions/payables';
import { Button } from '@/components/ui/Button';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('payables');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t('form.saving') : t('payment.submit')}</Button>;
}

export function RegisterPaymentForm({ payableId, saldoCents, today }: { payableId: string; saldoCents: number; today: string }) {
  const t = useTranslations('payables');
  const [state, action] = useActionState<ActionResult, FormData>(registerPayablePayment, {});
  const saldo = (saldoCents / 100).toFixed(2);

  return (
    <details className="text-left">
      <summary className="cursor-pointer text-brand-600 hover:underline">{t('payment.open')}</summary>
      <form action={action} className="mt-2 flex flex-col gap-2 min-w-48">
        <input type="hidden" name="payable_id" value={payableId} />
        <label className="text-xs text-slate-500">
          {t('payment.amount')}
          <input name="amount" type="number" step="0.01" min="0.01" max={saldo} defaultValue={saldo} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-slate-500">
          {t('payment.paidOn')}
          <input name="paid_on" type="date" defaultValue={today} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-slate-500">
          {t('payment.note')}
          <input name="note" maxLength={500} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <SubmitButton />
        {state.error && <p className="text-xs text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
      </form>
    </details>
  );
}
