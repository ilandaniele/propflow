'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { addAuthorizedVisitor } from '@/app/actions/visitors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('visitorAccess');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('addAuthorized')}</Button>;
}

export function AuthorizedVisitorForm({ units }: { units?: Array<{ id: string; label: string }> }) {
  const t = useTranslations('visitorAccess');
  const [state, action] = useActionState<ActionResult, FormData>(addAuthorizedVisitor, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
      {units && (
        <div className="space-y-1">
          <label htmlFor="authorized_unit_id" className="block text-sm font-medium text-slate-700">{t('unitLabel')}</label>
          <select id="authorized_unit_id" name="unit_id" required defaultValue="" className="h-9 w-full rounded border border-slate-300 px-2 text-sm">
            <option value="" disabled>{t('chooseUnit')}</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </div>
      )}
      <Input label={t('fullNameLabel')} name="full_name" required maxLength={200} />
      <Input label={t('documentLabel')} name="document_number" maxLength={30} />
      <Input label={t('relationshipLabel')} name="relationship" maxLength={100} placeholder={t('relationshipPlaceholder')} />
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
        <SubmitButton />
        {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
      </div>
    </form>
  );
}
