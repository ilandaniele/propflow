'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { addIncidentComment } from '@/app/actions/incidents';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.comment');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending}>{t('submit')}</Button>;
}

export function CommentForm({ incidentId }: { incidentId: string }) {
  const t = useTranslations('forms.comment');
  const [state, action] = useActionState<ActionResult, FormData>(addIncidentComment, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.data !== undefined) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="incident_id" value={incidentId} />
      <Textarea name="body" placeholder={t('placeholder')} rows={3} required />
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error.message}</p>}
      <SubmitButton />
    </form>
  );
}
