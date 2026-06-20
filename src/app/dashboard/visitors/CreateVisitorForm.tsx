'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createVisitorLog } from '@/app/actions/visitors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createVisitor');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('logging') : t('submit')}</Button>;
}

export function CreateVisitorForm() {
  const t = useTranslations('forms.createVisitor');
  const [state, action] = useActionState<ActionResult, FormData>(createVisitorLog, {});
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Input label={t('nameLabel')} name="visitor_name" required placeholder={t('namePlaceholder')} />
      <div className="space-y-1">
        <label htmlFor="visit_date" className="block text-sm font-medium text-slate-700">{t('dateLabel')}</label>
        <input id="visit_date" type="date" name="visit_date" required defaultValue={today} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      <Input label={t('purposeLabel')} name="purpose" placeholder={t('purposePlaceholder')} />
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton />
      </div>
      {state.error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3" role="alert">{state.error.message}</p>}
    </form>
  );
}
