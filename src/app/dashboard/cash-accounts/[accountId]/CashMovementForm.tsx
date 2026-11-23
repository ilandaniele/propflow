'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { addCashMovement } from '@/app/actions/cash-accounts';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function CashMovementForm({ accountId, defaultDate }: { accountId: string; defaultDate: string }) {
  const t = useTranslations('cashAccounts');
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult<{ saved: true }> | null, FormData>(addCashMovement, null);

  const errorText = state?.error
    ? state.error.code === 'INACTIVE' ? t('movement.inactive') : actionErrorMessage(state.error)
    : null;

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <input type="hidden" name="account_id" value={accountId} />
      <Select id={`${id}-direction`} name="direction" label={t('movement.direction')} defaultValue="in">
        <option value="in">{t('colIncome')}</option>
        <option value="out">{t('colOutflow')}</option>
      </Select>
      <Input id={`${id}-amount`} name="amount" type="number" step="0.01" min="0.01" label={t('movement.amount')} required />
      <Input id={`${id}-date`} name="occurred_on" type="date" defaultValue={defaultDate} label={t('colDate')} required />
      <Input id={`${id}-concept`} name="concept" maxLength={160} label={t('colConcept')} required className="sm:col-span-2" />
      <Input id={`${id}-document`} name="document" maxLength={60} label={t('colDocument')} />
      <div className="sm:col-span-3 flex items-center gap-3">
        <Button type="submit" loading={pending}>{t('movement.submit')}</Button>
        {errorText && <p role="alert" className="text-sm text-red-600">{errorText}</p>}
        {state?.data && <p className="text-sm text-green-700">{t('movement.saved')}</p>}
      </div>
    </form>
  );
}
