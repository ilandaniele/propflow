'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createLead } from '@/app/actions/ops';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createLead');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('submit')}</Button>;
}

export function CreateLeadForm() {
  const t = useTranslations('forms.createLead');
  const [state, action] = useActionState<ActionResult, FormData>(createLead, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Input label={t('nameLabel')} name="full_name" required placeholder={t('namePlaceholder')} />
      <Input label={t('emailLabel')} name="email" type="email" placeholder={t('emailPlaceholder')} />
      <Input label={t('phoneLabel')} name="phone" placeholder={t('phonePlaceholder')} />
      <Input label={t('interestLabel')} name="property_interest" placeholder={t('interestPlaceholder')} />
      <Input label={t('sourceLabel')} name="source" placeholder={t('sourcePlaceholder')} />
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton />
      </div>
      {state.error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3" role="alert">{state.error.message}</p>}
    </form>
  );
}
