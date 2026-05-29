'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createVisitorLog } from '@/app/actions/visitors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Logging…' : 'Log Visitor'}</Button>;
}

export function CreateVisitorForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createVisitorLog, {});
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Input label="Visitor name" name="visitor_name" required placeholder="John Doe" />
      <div className="space-y-1">
        <label htmlFor="visit_date" className="block text-sm font-medium text-slate-700">Visit date</label>
        <input id="visit_date" type="date" name="visit_date" required defaultValue={today} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      <Input label="Purpose" name="purpose" placeholder="Delivery, guest, maintenance…" />
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton />
      </div>
      {state.error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3" role="alert">{state.error.message}</p>}
    </form>
  );
}
