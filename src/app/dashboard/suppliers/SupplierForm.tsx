'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createSupplier, updateSupplier } from '@/app/actions/suppliers';
import { SUPPLIER_TRADES } from '@/lib/suppliers/constants';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';

export type SupplierFormValues = {
  id: string;
  name: string;
  trade: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export function SupplierForm({ supplier }: { supplier?: SupplierFormValues }) {
  const t = useTranslations('suppliers');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    supplier ? updateSupplier : createSupplier,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = supplier ? `supplier-${supplier.id}` : 'supplier-new';

  useEffect(() => {
    if (!supplier && state && !state.error) formRef.current?.reset();
  }, [state, supplier]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-2">
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <Input id={`${prefix}-name`} name="name" label={t('form.name')} defaultValue={supplier?.name} required maxLength={200} />
      <Select id={`${prefix}-trade`} name="trade" label={t('form.trade')} defaultValue={supplier?.trade ?? 'general'} required>
        {SUPPLIER_TRADES.map((trade) => <option key={trade} value={trade}>{t(`trades.${trade}`)}</option>)}
      </Select>
      <Input id={`${prefix}-phone`} name="phone" type="tel" label={t('form.phone')} defaultValue={supplier?.phone ?? ''} maxLength={40} />
      <Input id={`${prefix}-email`} name="email" type="email" label={t('form.email')} defaultValue={supplier?.email ?? ''} maxLength={200} />
      <div className="sm:col-span-2">
        <Textarea id={`${prefix}-notes`} name="notes" label={t('form.notes')} defaultValue={supplier?.notes ?? ''} rows={2} maxLength={1000} />
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>{supplier ? t('form.save') : t('form.create')}</Button>
        {state && !state.error && <p role="status" className="text-sm text-emerald-700">{t('form.saved')}</p>}
        {state?.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
      </div>
    </form>
  );
}
