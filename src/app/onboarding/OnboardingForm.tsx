'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createOrg, type AuthState } from '@/app/actions/onboarding';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        'w-full inline-flex items-center justify-center gap-2',
        'h-11 px-4 rounded-md text-sm font-medium transition-colors duration-150',
        'bg-brand-600 text-white shadow-sm',
        'hover:bg-brand-700 active:bg-brand-800',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-brand-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      ].join(' ')}
    >
      {pending ? (
        <>
          <svg
            className="animate-spin h-4 w-4 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Creating workspace...</span>
        </>
      ) : (
        <span>Create workspace</span>
      )}
    </button>
  );
}

export function OnboardingForm() {
  const [state, action] = useActionState<AuthState, FormData>(createOrg, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="orgName" className="block text-sm font-medium text-slate-700 mb-1.5">
          Organization name
        </label>
        <input
          id="orgName"
          name="orgName"
          type="text"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. Acme Rentals"
          autoComplete="organization"
          className={[
            'w-full rounded-md border text-sm transition-colors duration-150',
            'px-3 py-2 h-10',
            'text-slate-900 placeholder-slate-400',
            'border-slate-300 bg-white',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
            'disabled:bg-slate-50 disabled:text-slate-500',
          ].join(' ')}
        />
        <p className="mt-1 text-xs text-slate-500">
          This is your company or portfolio name. You can change it later.
        </p>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {state.error.message}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
