'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createAnnouncement } from '@/app/actions/ops';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save Draft'}</Button>;
}

export function AnnouncementForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createAnnouncement, {});

  return (
    <form action={action} className="space-y-4">
      <Input label="Title" name="title" required placeholder="Building maintenance notice" />
      <div className="space-y-1">
        <label htmlFor="body" className="block text-sm font-medium text-slate-700">Body</label>
        <textarea
          id="body"
          name="body"
          required
          rows={4}
          placeholder="There will be scheduled maintenance on..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="audience" className="block text-sm font-medium text-slate-700">Audience</label>
        <select
          id="audience"
          name="audience"
          defaultValue="all"
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All tenants</option>
          <option value="property">Specific property</option>
          <option value="unit">Specific unit</option>
        </select>
      </div>
      <SubmitButton />
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
