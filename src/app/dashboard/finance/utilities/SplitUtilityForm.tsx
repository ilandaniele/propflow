'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { splitUtilityBill, type SplitUtilityResult } from '@/app/actions/utility-split';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

function SubmitButton() {
  const t = useTranslations('utilities');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending}>{t('split.submit')}</Button>;
}

export function SplitUtilityForm({ servicePaymentId, months }: { servicePaymentId: string; months: string[] }) {
  const t = useTranslations('utilities');
  const [state, action] = useActionState<SplitUtilityResult, FormData>(splitUtilityBill, {});
  const formId = useId();
  const methodLabels = { equal: t('split.method_equal'), area: t('split.method_area'), days: t('split.method_days') };

  return (
    <form action={action} className="mt-4 border-t border-slate-100 pt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="service_payment_id" value={servicePaymentId} />
      <Select id={`${formId}-month`} label={t('split.month')} name="month" defaultValue={months[months.length - 1]} className="w-32">
        {months.map((month) => <option key={month} value={month}>{month}</option>)}
      </Select>
      <Select id={`${formId}-method`} label={t('split.method')} name="method" defaultValue="equal" className="w-40">
        {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <Input id={`${formId}-due`} label={t('split.dueDate')} name="due_date" type="date" required className="w-40" />
      <SubmitButton />
      <p className="w-full text-xs text-slate-500">{t('split.hint')}</p>
      {state.error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error.code === 'NO_AMOUNT' ? t('split.noAmount') : state.error.message}
        </p>
      )}
      {state.data && (
        <p role="status" className="w-full text-sm text-green-700">
          {t('split.done', { created: state.data.created, skipped: state.data.skipped })}
        </p>
      )}
    </form>
  );
}
