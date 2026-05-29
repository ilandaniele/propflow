'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateIncident } from '@/app/actions/incidents';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';
import type { Incident } from '@/types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending} className="w-full">Save Changes</Button>;
}

interface Props {
  incident: Incident;
  admins: Array<{ id: string; full_name: string | null }>;
}

export function UpdateIncidentForm({ incident, admins }: Props) {
  const [state, action] = useActionState<ActionResult, FormData>(updateIncident, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={incident.id} />
      <Select label="Status" name="status" defaultValue={incident.status}>
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="solved">Solved</option>
      </Select>
      <Select label="Priority" name="priority" defaultValue={incident.priority}>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </Select>
      <Select label="Assign to" name="assigned_to" defaultValue={incident.assigned_to ?? ''}>
        <option value="">Unassigned</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>{a.full_name ?? a.id}</option>
        ))}
      </Select>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error.message}</p>}
      {state.data !== undefined && <p className="text-xs text-green-600">Saved</p>}
      <SubmitButton />
    </form>
  );
}
