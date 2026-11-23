'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createApiKey, revokeApiKeyAction } from '@/app/actions/api-keys';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function SubmitButton({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'danger' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>;
}

export function CreateApiKeyForm() {
  const t = useTranslations('apiKeys');
  const [state, action] = useActionState<ActionResult<{ token: string }>, FormData>(createApiKey, {});

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <Input label={t('nameLabel')} name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
        </div>
        <SubmitButton label={t('create')} />
      </form>
      {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
      {state.data?.token && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2" role="status">
          <p className="text-sm font-medium text-amber-900">{t('createdTitle')}</p>
          <code className="block break-all rounded bg-white px-3 py-2 text-xs text-slate-900 select-all">{state.data.token}</code>
          <p className="text-xs text-amber-800">{t('createdHint')}</p>
        </div>
      )}
    </div>
  );
}

export function RevokeApiKeyForm({ id }: { id: string }) {
  const t = useTranslations('apiKeys');
  const [state, action] = useActionState<ActionResult, FormData>(revokeApiKeyAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton label={t('revoke')} variant="danger" />
      {state.error && <p className="text-xs text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
