'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createTenant } from '@/app/actions/tenants';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.createTenant');
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">{t('submit')}</Button>;
}

export function CreateTenantForm() {
  const t = useTranslations('forms.createTenant');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createTenant, {});

  if (state.data !== undefined && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{t('openButton')}</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create tenant">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">{t('modalTitle')}</h2>
            <form action={action} className="space-y-4">
              <Input label={t('nameLabel')} name="full_name" required placeholder="Jane Smith" />
              <Input label={t('emailLabel')} name="email" type="email" placeholder="jane@example.com" />
              <Input label={t('phoneLabel')} name="phone" placeholder="+1 555 000 0000" />
              <Textarea label={t('notesLabel')} name="notes" placeholder="Any notes about this tenant..." rows={3} />
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
