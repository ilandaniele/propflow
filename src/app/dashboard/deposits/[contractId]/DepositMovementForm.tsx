'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { saveDepositMovement } from '@/app/actions/deposits';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatMoney } from '@/lib/finance/format-money';

export function DepositMovementForm({ contractId, held }: { contractId: string; held: number }) {
  const t = useTranslations('deposits');
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveDepositMovement, null);
  const today = new Date().toISOString().slice(0, 10);

  const errorText = state?.error
    ? state.error.code === 'EXCEEDS_BALANCE'
      ? t('form.exceeds', { held: formatMoney(held) })
      : actionErrorMessage(state.error)
    : null;

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input type="hidden" name="contract_id" value={contractId} />
      <Select id={`${id}-kind`} name="kind" label={t('colKind')} required defaultValue="collected">
        <option value="collected">{t('kindCollected')}</option>
        <option value="deduction">{t('kindDeduction')}</option>
        <option value="refund">{t('kindRefund')}</option>
      </Select>
      <Input id={`${id}-amount`} name="amount" type="number" step="0.01" min="0.01" label={t('colAmount')} required />
      <Input id={`${id}-date`} name="moved_on" type="date" label={t('colDate')} defaultValue={today} required />
      <Input id={`${id}-desc`} name="description" maxLength={300} label={t('colDescription')} />
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" loading={pending}>{t('form.submit')}</Button>
        {errorText && <p role="alert" className="text-sm text-red-600">{errorText}</p>}
        {state && !state.error && <p className="text-sm text-green-700">{t('form.saved')}</p>}
      </div>
    </form>
  );
}
