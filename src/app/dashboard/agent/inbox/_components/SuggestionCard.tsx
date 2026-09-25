'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { approveAgentSuggestion, discardAgentSuggestion } from '@/app/actions/agent-inbox';
import type { ActionResult } from '@/lib/errors';

function SubmitButton({ children, variant }: { children: ReactNode; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        'px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors',
        variant === 'primary'
          ? 'bg-brand-600 text-white hover:bg-brand-700'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** Shadow mode's review card: edit or send the draft as-is, or discard it. */
export function SuggestionCard({ suggestionId, body }: { suggestionId: string; body: string }) {
  const t = useTranslations('agentInbox');
  const [editedBody, setEditedBody] = useState(body);
  const [approveState, approveAction] = useActionState<ActionResult, FormData>(approveAgentSuggestion, {});
  const [discardState, discardAction] = useActionState<ActionResult, FormData>(discardAgentSuggestion, {});

  const wasEdited = editedBody !== body;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{t('pendingSuggestion')}</p>
      <form action={approveAction} className="space-y-2">
        <input type="hidden" name="suggestion_id" value={suggestionId} />
        <textarea
          // Only sent to the server when the human actually edited the draft
          // (approveAgentSuggestion treats an unnamed field as "approve as-is").
          name={wasEdited ? 'body' : undefined}
          value={editedBody}
          onChange={(e) => setEditedBody(e.target.value)}
          rows={3}
          maxLength={4096}
          className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex gap-2">
          <SubmitButton variant="primary">{t('approveSuggestion')}</SubmitButton>
        </div>
      </form>
      <form action={discardAction}>
        <input type="hidden" name="suggestion_id" value={suggestionId} />
        <SubmitButton variant="secondary">{t('discardSuggestion')}</SubmitButton>
      </form>
      {approveState.error && <p className="text-xs text-red-600">{approveState.error.message}</p>}
      {discardState.error && <p className="text-xs text-red-600">{discardState.error.message}</p>}
    </div>
  );
}
