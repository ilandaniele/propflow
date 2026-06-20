'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { updateIncident } from '@/app/actions/incidents';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';
import type { Incident } from '@/types';

function SubmitButton() {
  const t = useTranslations('forms.updateIncident');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending} className="w-full">{t('submit')}</Button>;
}

interface Props {
  incident: Incident;
  admins: Array<{ id: string; full_name: string | null }>;
}

export function UpdateIncidentForm({ incident, admins }: Props) {
  const t = useTranslations('forms.updateIncident');
  const [state, action] = useActionState<ActionResult, FormData>(updateIncident, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={incident.id} />
      <Select label={t('statusLabel')} name="status" defaultValue={incident.status}>
        <option value="pending">{t('statusPending')}</option>
        <option value="in_progress">{t('statusInProgress')}</option>
        <option value="solved">{t('statusSolved')}</option>
      </Select>
      <Select label={t('priorityLabel')} name="priority" defaultValue={incident.priority}>
        <option value="low">{t('priorityLow')}</option>
        <option value="medium">{t('priorityMedium')}</option>
        <option value="high">{t('priorityHigh')}</option>
        <option value="urgent">{t('priorityUrgent')}</option>
      </Select>
      <Select label={t('assignLabel')} name="assigned_to" defaultValue={incident.assigned_to ?? ''}>
        <option value="">{t('unassigned')}</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>{a.full_name ?? a.id}</option>
        ))}
      </Select>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error.message}</p>}
      {state.data !== undefined && <p className="text-xs text-green-600">{t('saved')}</p>}
      <SubmitButton />
    </form>
  );
}
