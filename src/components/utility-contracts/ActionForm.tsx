'use client';

import { useActionState, type ReactNode } from 'react';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

type Props = {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel: string;
  className?: string;
  danger?: boolean;
  children?: ReactNode;
};

export function ActionForm({ action, submitLabel, pendingLabel, className = '', danger = false, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const buttonClass = danger
    ? 'text-sm text-red-600 hover:underline'
    : 'rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700';

  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" disabled={pending} className={`${buttonClass} disabled:opacity-50`}>
        {pending ? pendingLabel : submitLabel}
      </button>
      {state.error && <p className="w-full text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
