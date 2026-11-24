'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { closePollAction, createPoll } from '@/app/actions/polls';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function SubmitButton({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>;
}

export function CreatePollForm() {
  const t = useTranslations('polls');
  const [state, action] = useActionState<ActionResult, FormData>(createPoll, {});

  return (
    <form action={action} className="space-y-3">
      <Input label={t('questionLabel')} name="question" required maxLength={200} placeholder={t('questionPlaceholder')} />
      <div className="space-y-1">
        <label htmlFor="poll-options" className="block text-sm font-medium text-slate-700">{t('optionsLabel')}</label>
        <textarea id="poll-options" name="options" required rows={4} placeholder={t('optionsPlaceholder')} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <p className="text-xs text-slate-500">{t('optionsHint')}</p>
      </div>
      <div className="space-y-1 max-w-xs">
        <label htmlFor="poll-closes-on" className="block text-sm font-medium text-slate-700">{t('closesOnLabel')}</label>
        <input id="poll-closes-on" type="date" name="closes_on" className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      <SubmitButton label={t('create')} />
      {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}

export function ClosePollForm({ pollId }: { pollId: string }) {
  const t = useTranslations('polls');
  const [state, action] = useActionState<ActionResult, FormData>(closePollAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="poll_id" value={pollId} />
      <SubmitButton label={t('close')} variant="secondary" />
      {state.error && <p className="text-xs text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
