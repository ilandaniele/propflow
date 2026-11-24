'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createExpense } from '@/app/actions/finance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EXPENSE_KINDS } from '@/lib/schemas/finance';
import type { ActionResult } from '@/lib/errors';

interface Option { id: string; label: string }

const selectClass = 'h-9 rounded border border-slate-300 px-2 text-sm';

function SubmitButton() {
  const t = useTranslations('expenses');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('submit')}</Button>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function OptionalSelect({ id, options, emptyLabel }: { id: string; options: Option[]; emptyLabel: string }) {
  return (
    <select id={id} name={id} defaultValue="" className={selectClass}>
      <option value="">{emptyLabel}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  );
}

export function CreateExpenseForm({ categories, properties, today }: { categories: Option[]; properties: Option[]; today: string }) {
  const t = useTranslations('expenses');
  const [state, action] = useActionState<ActionResult, FormData>(createExpense, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
      <Input label={t('descriptionLabel')} name="description" required maxLength={500} />
      <Input label={t('amountLabel')} name="amount" type="number" step="0.01" min="0.01" required />
      <Input label={t('dateLabel')} name="incurred_on" type="date" defaultValue={today} required />
      <Field id="kind" label={t('kindLabel')}>
        <select id="kind" name="kind" defaultValue="ordinary" className={selectClass}>
          {EXPENSE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kind.${kind}`)}</option>)}
        </select>
      </Field>
      <Field id="category_id" label={t('categoryLabel')}>
        <OptionalSelect id="category_id" options={categories} emptyLabel={t('none')} />
      </Field>
      <Field id="property_id" label={t('propertyLabel')}>
        <OptionalSelect id="property_id" options={properties} emptyLabel={t('none')} />
      </Field>
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
        <SubmitButton />
        {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
      </div>
    </form>
  );
}
