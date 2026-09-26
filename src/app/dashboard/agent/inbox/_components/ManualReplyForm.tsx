'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { sendAgentInboxReply } from '@/app/actions/agent-inbox';
import type { ActionResult } from '@/lib/errors';

function SendButton() {
  const t = useTranslations('agentInbox');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? t('sending') : t('send')}
    </button>
  );
}

/** Disabled with a notice when the 24h customer-service window is closed. */
export function ManualReplyForm({ sessionId, windowOpen }: { sessionId: string; windowOpen: boolean }) {
  const t = useTranslations('agentInbox');
  const [state, action] = useActionState<ActionResult, FormData>(sendAgentInboxReply, {});

  if (!windowOpen) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        {t('windowClosedNotice')}
      </p>
    );
  }

  return (
    <div>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="session_id" value={sessionId} />
        <input
          name="body"
          type="text"
          placeholder={t('replyPlaceholder')}
          maxLength={4096}
          required
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <SendButton />
      </form>
      {state.error && <p className="text-xs text-red-600 mt-2">{state.error.message}</p>}
    </div>
  );
}
