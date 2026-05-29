'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createContractTemplate } from '@/app/actions/contractDoc';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Create Template'}</Button>;
}

export function ContractTemplateForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createContractTemplate, {});

  return (
    <form action={action} className="space-y-4">
      <Input label="Template name" name="name" required placeholder="Standard Lease Agreement" />
      <div className="space-y-1">
        <label htmlFor="body_markdown" className="block text-sm font-medium text-slate-700">
          Template body <span className="text-slate-400 font-normal">(Markdown, use {'{{variable_name}}'} for substitution)</span>
        </label>
        <textarea
          id="body_markdown"
          name="body_markdown"
          required
          rows={12}
          placeholder={'## Rental Agreement\n\nThis agreement is between {{org_name}} and {{tenant_name}}.\n\n...'}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <input type="hidden" name="variables" value="[]" />
      <SubmitButton />
      {state.error && (
        <p className="text-sm text-red-600" role="alert">{state.error.message}</p>
      )}
    </form>
  );
}
