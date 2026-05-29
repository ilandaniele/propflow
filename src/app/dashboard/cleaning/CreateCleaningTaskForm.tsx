'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createCleaningTask } from '@/app/actions/ops';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Create Task'}</Button>;
}

export function CreateCleaningTaskForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createCleaningTask, {});
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-wrap gap-3 items-end">
      <Input label="Task title" name="title" required placeholder="Clean unit 1A" className="flex-1 min-w-48" />
      <div className="space-y-1">
        <label htmlFor="scheduled_date" className="block text-sm font-medium text-slate-700">Scheduled date</label>
        <input
          id="scheduled_date"
          type="date"
          name="scheduled_date"
          required
          defaultValue={today}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
