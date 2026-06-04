'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createVisitorLog } from '@/app/actions/visitors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Registering…' : 'Register Visitor'}</Button>;
}

export function RegisterVisitorForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createVisitorLog, {});
  const today = new Date().toISOString().slice(0, 10);
  const [success, setSuccess] = useState(false);

  if (success) {
    return (
      <div className="text-center py-6 space-y-2">
        <p className="text-green-700 font-medium">Visitor registered successfully.</p>
        <button onClick={() => setSuccess(false)} className="text-sm text-brand-600 hover:underline">Register another</button>
      </div>
    );
  }

  return (
    <form action={async (formData) => {
      // useActionState dispatch is typed as returning void; cast via unknown to read inline result
      const result = await (action as unknown as (fd: FormData) => Promise<ActionResult>)(formData);
      if (!result?.error) setSuccess(true);
    }} className="space-y-4">
      <Input label="Visitor name" name="visitor_name" required placeholder="Jane Doe" />
      <div className="space-y-1">
        <label htmlFor="visit_date" className="block text-sm font-medium text-slate-700">Visit date</label>
        <input id="visit_date" type="date" name="visit_date" required defaultValue={today} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" />
      </div>
      <Input label="Purpose (optional)" name="purpose" placeholder="Guest, delivery, etc." />
      <SubmitButton />
      {state?.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
