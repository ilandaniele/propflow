'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { closePeriod, reopenPeriod } from '@/app/actions/period-close';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function SubmitButton({ label, variant }: { label: string; variant?: 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>;
}

function ErrorText({ state }: { state: ActionResult }) {
  return state.error ? <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p> : null;
}

export function ClosePeriodForm({ defaultPeriod }: { defaultPeriod: string }) {
  const t = useTranslations('periodClose');
  const [state, action] = useActionState<ActionResult, FormData>(closePeriod, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input label={t('periodLabel')} name="period" type="month" required defaultValue={defaultPeriod} />
        <Input label={t('noteLabel')} name="note" maxLength={500} placeholder={t('notePlaceholder')} />
        <SubmitButton label={t('close')} />
      </div>
      <ErrorText state={state} />
    </form>
  );
}

export function ReopenPeriodForm({ period }: { period: string }) {
  const t = useTranslations('periodClose');
  const [state, action] = useActionState<ActionResult, FormData>(reopenPeriod, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="period" value={period} />
      <SubmitButton label={t('reopen')} variant="secondary" />
      <ErrorText state={state} />
    </form>
  );
}
