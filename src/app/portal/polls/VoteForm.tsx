'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { voteInPoll } from '@/app/actions/polls';
import { Button } from '@/components/ui/Button';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

interface VoteFormProps {
  pollId: string;
  options: { id: string; label: string }[];
}

function SubmitButton() {
  const t = useTranslations('polls');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{t('vote')}</Button>;
}

export function VoteForm({ pollId, options }: VoteFormProps) {
  const t = useTranslations('polls');
  const [state, action] = useActionState<ActionResult, FormData>(voteInPoll, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="poll_id" value={pollId} />
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('chooseOption')}</legend>
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
            <input type="radio" name="option_id" value={option.id} required className="accent-brand-600" />
            {option.label}
          </label>
        ))}
      </fieldset>
      <SubmitButton />
      {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
