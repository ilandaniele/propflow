'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createPaymentFromBankLine, matchBankLine, setBankLineIgnored } from '@/app/actions/bank-reconciliation';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { formatSoles } from './format';

type Candidate = { id: string; amount: string; paidAt: string; tenantName: string | null };
type ContractOption = { id: string; tenantName: string };

export type ReconciliationRow = {
  id: string;
  postedOn: string;
  description: string;
  reference: string | null;
  amount: string;
  candidates: Candidate[];
  suggestedId: string | null;
};

const selectClass = 'rounded-md border border-slate-300 px-2 py-1 text-xs max-w-56';

function ErrorText({ state }: { state: ActionResult<unknown> | null }) {
  return state?.error ? <p role="alert" className="w-full text-right text-xs text-red-600">{actionErrorMessage(state.error)}</p> : null;
}

function MatchForm({ row }: { row: ReconciliationRow }) {
  const t = useTranslations('bankReconciliation');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(matchBankLine, null);
  if (row.candidates.length === 0) return <span className="text-xs text-slate-400">{t('actions.noCandidates')}</span>;

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="line_id" value={row.id} />
      <select name="payment_id" defaultValue={row.suggestedId ?? row.candidates[0].id} aria-label={t('actions.payment')} className={selectClass}>
        {row.candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.id === row.suggestedId ? '★ ' : ''}{candidate.tenantName ?? '—'} · {candidate.paidAt}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" loading={pending}>{t('actions.match')}</Button>
      <ErrorText state={state} />
    </form>
  );
}

function CreatePaymentForm({ lineId, contracts }: { lineId: string; contracts: ContractOption[] }) {
  const t = useTranslations('bankReconciliation');
  const [state, formAction, pending] = useActionState<ActionResult<{ paymentId: string }> | null, FormData>(createPaymentFromBankLine, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="line_id" value={lineId} />
      <select name="contract_id" required defaultValue="" aria-label={t('actions.contract')} className={selectClass}>
        <option value="" disabled>{t('actions.contract')}</option>
        {contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.tenantName}</option>)}
      </select>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>{t('actions.createPayment')}</Button>
      <ErrorText state={state} />
    </form>
  );
}

function IgnoreForm({ lineId }: { lineId: string }) {
  const t = useTranslations('bankReconciliation');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(setBankLineIgnored, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="ignored" value="true" />
      <Button type="submit" size="sm" variant="ghost" loading={pending}>{t('actions.ignore')}</Button>
      <ErrorText state={state} />
    </form>
  );
}

function LineRow({ row, contracts }: { row: ReconciliationRow; contracts: ContractOption[] }) {
  const t = useTranslations('bankReconciliation');
  const [creating, setCreating] = useState(false);

  return (
    <tr className="align-top">
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{row.postedOn}</td>
      <td className="px-4 py-3 text-slate-900">
        {row.description}
        {row.reference && <span className="block text-xs text-slate-500">{row.reference}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">{formatSoles(row.amount)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-end gap-2">
          <MatchForm row={row} />
          {creating && contracts.length > 0 ? (
            <CreatePaymentForm lineId={row.id} contracts={contracts} />
          ) : (
            <div className="flex gap-2">
              {contracts.length > 0 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(true)}>{t('actions.newPayment')}</Button>
              )}
              <IgnoreForm lineId={row.id} />
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function ReconciliationTable({ rows, contracts }: { rows: ReconciliationRow[]; contracts: ContractOption[] }) {
  const t = useTranslations('bankReconciliation');

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm" aria-label={t('title')}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <th className="text-left px-4 py-3">{t('colDate')}</th>
            <th className="text-left px-4 py-3">{t('colDescription')}</th>
            <th className="text-right px-4 py-3">{t('colAmount')}</th>
            <th className="text-right px-4 py-3">{t('colActions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => <LineRow key={row.id} row={row} contracts={contracts} />)}
        </tbody>
      </table>
    </div>
  );
}
