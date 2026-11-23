'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createPayable } from '@/app/actions/payables';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

type Option = { id: string; name: string };

function SubmitButton() {
  const t = useTranslations('payables');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('form.saving') : t('form.create')}</Button>;
}

export function CreatePayableForm({ properties, categories, today }: { properties: Option[]; categories: Option[]; today: string }) {
  const t = useTranslations('payables');
  const [state, action] = useActionState<ActionResult, FormData>(createPayable, {});

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input id="payable-supplier" label={t('form.supplier')} name="supplier_name" required maxLength={200} />
      <Input id="payable-description" label={t('form.description')} name="description" maxLength={500} />
      <Input id="payable-document" label={t('form.documentRef')} name="document_ref" maxLength={100} />
      <Input id="payable-amount" label={t('form.amount')} name="amount" type="number" step="0.01" min="0.01" required />
      <Input id="payable-issued" label={t('form.issuedOn')} name="issued_on" type="date" defaultValue={today} required />
      <Input id="payable-due" label={t('form.dueOn')} name="due_on" type="date" required />
      <Select id="payable-property" label={t('form.property')} name="property_id" defaultValue="">
        <option value="">{t('form.none')}</option>
        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select id="payable-category" label={t('form.category')} name="category_id" defaultValue="">
        <option value="">{t('form.none')}</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
        <SubmitButton />
        {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
        {'data' in state && <p className="text-sm text-green-700" role="status">{t('form.created')}</p>}
      </div>
    </form>
  );
}
