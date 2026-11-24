'use client';

import { useActionState, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createCashAccount } from '@/app/actions/cash-accounts';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function CashAccountForm() {
  const t = useTranslations('cashAccounts');
  const id = useId();
  const [kind, setKind] = useState('bank');
  const [state, formAction, pending] = useActionState<ActionResult<{ accountId: string }> | null, FormData>(createCashAccount, null);

  return (
    <details className="bg-white rounded-xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('form.open')}</summary>
      <form action={formAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input id={`${id}-name`} name="name" maxLength={80} label={t('form.name')} required />
        <Select id={`${id}-kind`} name="kind" label={t('form.kind')} value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="bank">{t('kindBank')}</option>
          <option value="cash">{t('kindCash')}</option>
        </Select>
        {kind === 'bank' && (
          <>
            <Input id={`${id}-bank`} name="bank_name" maxLength={80} label={t('form.bankName')} />
            <Input id={`${id}-number`} name="account_number" maxLength={40} label={t('form.accountNumber')} />
          </>
        )}
        <Input id={`${id}-opening`} name="opening_balance" type="number" step="0.01" defaultValue="0" label={t('form.openingBalance')} required />
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" loading={pending}>{t('form.submit')}</Button>
          {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
          {state?.data && <p className="text-sm text-green-700">{t('form.saved')}</p>}
        </div>
      </form>
    </details>
  );
}
