'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { importBankStatement } from '@/app/actions/bank-reconciliation';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

type Summary = { inserted: number; duplicates: number; skipped: number };

export function UploadStatementForm() {
  const t = useTranslations('bankReconciliation.upload');
  const [state, formAction, pending] = useActionState<ActionResult<Summary> | null, FormData>(importBankStatement, null);

  return (
    <form action={formAction} className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <label htmlFor="statement-file" className="block text-sm font-medium text-slate-700">{t('label')}</label>
      <p className="text-xs text-slate-500">{t('hint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input id="statement-file" type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <Button type="submit" size="sm" loading={pending}>{t('submit')}</Button>
      </div>
      {state?.data && <p role="status" className="text-sm text-emerald-700">{t('result', state.data)}</p>}
      {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
