'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { saveChargeConcept } from '@/app/actions/charge-concepts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export interface ChargeConceptValues {
  id: string;
  description: string;
  code: string | null;
  baseAmount: string | null;
}

function SubmitButton() {
  const t = useTranslations('chargeConcepts');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending}>{t('save')}</Button>;
}

export function ChargeConceptForm({ concept }: { concept?: ChargeConceptValues }) {
  const t = useTranslations('chargeConcepts');
  const [state, action] = useActionState<ActionResult, FormData>(saveChargeConcept, {});
  const formId = useId();

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {concept && <input type="hidden" name="id" value={concept.id} />}
      <Input id={`${formId}-description`} label={t('description')} name="description" required maxLength={200} defaultValue={concept?.description} className="flex-1 min-w-48" />
      <Input id={`${formId}-code`} label={t('code')} name="code" maxLength={40} defaultValue={concept?.code ?? ''} className="w-28" />
      <Input id={`${formId}-base-amount`} label={t('baseAmount')} name="base_amount" type="number" min="0" step="0.01" defaultValue={concept?.baseAmount ?? ''} className="w-32" />
      <SubmitButton />
      {state.error && <p role="alert" className="w-full text-sm text-red-600">{state.error.message}</p>}
      {'data' in state && <p role="status" className="w-full text-sm text-green-700">{t('saved')}</p>}
    </form>
  );
}
