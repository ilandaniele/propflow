'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createCharge } from '@/app/actions/payments';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createCharge');
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">{pending ? t('creating') : t('submit')}</Button>;
}

interface Contract {
  id: string;
  monthly_rent: number;
  tenant_id: string;
  tenants: { full_name: string } | null;
}

export interface ChargeConceptOption {
  id: string;
  description: string;
  baseAmount: string | null;
}

export function CreateChargeForm({ contracts, concepts }: { contracts: Contract[]; concepts: ChargeConceptOption[] }) {
  const t = useTranslations('forms.createCharge');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createCharge, {});
  const [contractId, setContractId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  if (state.data !== undefined && open) setOpen(false);

  const tenantId = contracts.find((c) => c.id === contractId)?.tenant_id ?? '';

  function applyConcept(conceptId: string) {
    const concept = concepts.find((c) => c.id === conceptId);
    if (!concept) return;
    setDescription(concept.description);
    if (concept.baseAmount !== null) setAmount(concept.baseAmount);
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t('openButton')}</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create charge">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">{t('modalTitle')}</h2>
            <form action={action} className="space-y-4">
              <Select label="Contract" name="contract_id" required value={contractId} onChange={(e) => setContractId(e.target.value)}>
                <option value="">{t('selectContract')}</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenants?.full_name ?? 'Unknown'} — S/ {Number(c.monthly_rent).toLocaleString('es-PE', { minimumFractionDigits: 2 })}{t('perMonth')}
                  </option>
                ))}
              </Select>
              <input type="hidden" name="tenant_id" value={tenantId} />
              {concepts.length > 0 && (
                <Select label={t('conceptLabel')} defaultValue="" onChange={(e) => applyConcept(e.target.value)}>
                  <option value="">{t('selectConcept')}</option>
                  {concepts.map((c) => (
                    <option key={c.id} value={c.id}>{c.description}</option>
                  ))}
                </Select>
              )}
              <Input label="Description" name="description" required placeholder="e.g. Rent - June 2025" value={description} onChange={(e) => setDescription(e.target.value)} />
              <Input label="Amount (S/)" name="amount" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('periodLabel')} name="period" type="date" />
                <Input label={t('dueDateLabel')} name="due_date" type="date" />
              </div>
              {state.error && (
                <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
              )}
              <div className="flex gap-2 pt-1">
                <SubmitButton />
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
