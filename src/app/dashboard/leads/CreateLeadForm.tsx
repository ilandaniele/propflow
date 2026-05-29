'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createLead } from '@/app/actions/ops';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add Lead'}</Button>;
}

export function CreateLeadForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createLead, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Input label="Full name" name="full_name" required placeholder="Jane Smith" />
      <Input label="Email" name="email" type="email" placeholder="jane@example.com" />
      <Input label="Phone" name="phone" placeholder="+1 555 000 0000" />
      <Input label="Property interest" name="property_interest" placeholder="2-bedroom apartment" />
      <Input label="Source" name="source" placeholder="Zillow, referral, walk-in…" />
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton />
      </div>
      {state.error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3" role="alert">{state.error.message}</p>}
    </form>
  );
}
