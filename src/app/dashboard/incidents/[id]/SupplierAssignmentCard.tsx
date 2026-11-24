'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { assignSupplierToIncident, updateSupplierAssignment } from '@/app/actions/suppliers';
import { SUPPLIER_ASSIGNMENT_STATUSES } from '@/lib/suppliers/constants';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';

type SupplierOption = { id: string; name: string; trade: string };
type Assignment = {
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  status: string;
  quoteAmount: string | null;
  finalCost: string | null;
  notes: string | null;
};

function FormStatus({ state }: { state: ActionResult | null }) {
  const t = useTranslations('suppliers');
  if (state?.error) return <p role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</p>;
  if (state) return <p role="status" className="text-xs text-emerald-700">{t('form.saved')}</p>;
  return null;
}

function AssignForm({ incidentId, options, current }: { incidentId: string; options: SupplierOption[]; current?: string }) {
  const t = useTranslations('suppliers');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(assignSupplierToIncident, null);

  if (options.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {t('assignment.noSuppliers')} <Link href="/dashboard/suppliers" className="underline">{t('assignment.addSupplier')}</Link>
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="incident_id" value={incidentId} />
      <Select id="assign-supplier" name="supplier_id" label={t('assignment.supplier')} defaultValue={current ?? options[0].id} required>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name} · {t(`trades.${option.trade}`)}</option>)}
      </Select>
      <Button type="submit" size="sm" variant={current ? 'secondary' : 'primary'} loading={pending}>
        {current ? t('assignment.reassign') : t('assignment.assign')}
      </Button>
      <FormStatus state={state} />
    </form>
  );
}

function AssignmentForm({ incidentId, assignment }: { incidentId: string; assignment: Assignment }) {
  const t = useTranslations('suppliers');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(updateSupplierAssignment, null);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="incident_id" value={incidentId} />
      <Select id="assignment-status" name="status" label={t('assignment.status')} defaultValue={assignment.status}>
        {SUPPLIER_ASSIGNMENT_STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}
      </Select>
      <Input id="assignment-quote" name="quote_amount" type="number" step="0.01" min="0" inputMode="decimal" label={t('assignment.quote')} defaultValue={assignment.quoteAmount ?? ''} />
      <Input id="assignment-cost" name="final_cost" type="number" step="0.01" min="0" inputMode="decimal" label={t('assignment.finalCost')} defaultValue={assignment.finalCost ?? ''} />
      <Textarea id="assignment-notes" name="notes" label={t('assignment.notes')} rows={2} maxLength={1000} defaultValue={assignment.notes ?? ''} />
      <Button type="submit" size="sm" loading={pending}>{t('form.save')}</Button>
      <FormStatus state={state} />
    </form>
  );
}

export function SupplierAssignmentCard({ incidentId, options, assignment }: { incidentId: string; options: SupplierOption[]; assignment: Assignment | null }) {
  const t = useTranslations('suppliers');

  return (
    <div className="space-y-4">
      {assignment && (
        <>
          <div className="text-sm">
            <p className="font-medium text-slate-900">{assignment.supplierName}</p>
            {assignment.supplierPhone && <a href={`tel:${assignment.supplierPhone}`} className="text-slate-600 underline">{assignment.supplierPhone}</a>}
          </div>
          <AssignmentForm key={assignment.supplierId} incidentId={incidentId} assignment={assignment} />
        </>
      )}
      <div className={assignment ? 'pt-3 border-t border-slate-100' : ''}>
        {!assignment && <p className="text-sm text-slate-500 mb-2">{t('assignment.none')}</p>}
        <AssignForm incidentId={incidentId} options={options} current={assignment?.supplierId} />
      </div>
    </div>
  );
}
