'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import { disputeSanction } from '@/app/actions/sanctions';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? 'Submitting...' : 'Submit Dispute'}
    </button>
  );
}

export default function DisputeSanctionPage() {
  const params = useParams();
  const router = useRouter();
  const sanctionId = params.id as string;
  const [state, action] = useActionState<ActionResult, FormData>(disputeSanction, {});

  // Redirect after success
  if (state.data !== undefined) {
    router.push('/portal/sanctions');
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <a href="/portal/sanctions" className="text-sm text-brand-600 hover:text-brand-800">← Back to Sanctions</a>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Dispute Sanction</h1>
        <p className="text-sm text-slate-500 mt-1">
          Explain why you believe this sanction is incorrect. Your landlord will review your dispute.
        </p>
      </div>

      <form action={action} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <input type="hidden" name="id" value={sanctionId} />

        <div>
          <label htmlFor="dispute_reason" className="block text-sm font-medium text-slate-700 mb-1">
            Reason for dispute <span className="text-red-500">*</span>
          </label>
          <textarea
            id="dispute_reason"
            name="dispute_reason"
            required
            rows={5}
            minLength={10}
            maxLength={1000}
            placeholder="Describe your reason for disputing this sanction..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {state.error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {state.error.message}
          </div>
        )}

        <div className="flex items-center gap-3">
          <SubmitButton />
          <a href="/portal/sanctions" className="text-sm text-slate-500 hover:text-slate-700">Cancel</a>
        </div>
      </form>
    </div>
  );
}
