'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createExpenseCategory } from '@/app/actions/finance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createExpenseCategory');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('submit')}</Button>;
}

export function CreateExpenseCategoryForm() {
  const t = useTranslations('forms.createExpenseCategory');
  const [state, action] = useActionState<ActionResult, FormData>(createExpenseCategory, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Input
        label={t('nameLabel')}
        name="name"
        required
        placeholder={t('namePlaceholder')}
        className="flex-1 min-w-48"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="color" className="text-sm font-medium text-slate-700">{t('colorLabel')}</label>
        <input
          id="color"
          type="color"
          name="color"
          defaultValue="#94a3b8"
          className="h-9 w-16 rounded border border-slate-300 cursor-pointer"
        />
      </div>
      <SubmitButton />
      {state.error && (
        <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p>
      )}
    </form>
  );
}
