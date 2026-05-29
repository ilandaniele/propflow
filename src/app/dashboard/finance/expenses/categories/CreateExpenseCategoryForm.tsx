'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createExpenseCategory } from '@/app/actions/finance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add Category'}</Button>;
}

export function CreateExpenseCategoryForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createExpenseCategory, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Input
        label="Category name"
        name="name"
        required
        placeholder="e.g. Maintenance"
        className="flex-1 min-w-48"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="color" className="text-sm font-medium text-slate-700">Color (optional)</label>
        <input
          id="color"
          type="color"
          name="color"
          defaultValue="#94a3b8"
          className="h-9 w-16 rounded border border-slate-300 cursor-pointer"
        />
      </div>
      <SubmitButton />
      {state.error && (
        <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p>
      )}
    </form>
  );
}
