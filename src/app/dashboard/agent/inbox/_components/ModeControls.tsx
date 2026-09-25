'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { takeOverSession, returnSessionToAi } from '@/app/actions/agent-inbox';
import type { ActionResult } from '@/lib/errors';
import type { AgentSessionMode } from '@/lib/agent/session';

function ActionButton({ children, variant }: { children: ReactNode; variant: 'primary' | 'secondary' }) {
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

export function ModeControls({ sessionId, mode }: { sessionId: string; mode: AgentSessionMode }) {
  const t = useTranslations('agentInbox');
  const [takeOverState, takeOverAction] = useActionState<ActionResult, FormData>(takeOverSession, {});
  const [returnState, returnAction] = useActionState<ActionResult, FormData>(returnSessionToAi, {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">{t(`mode.${mode}` as Parameters<typeof t>[0])}</span>
        <form action={takeOverAction}>
          <input type="hidden" name="session_id" value={sessionId} />
          <ActionButton variant="secondary">{t('takeOver')}</ActionButton>
        </form>
        <form action={returnAction}>
          <input type="hidden" name="session_id" value={sessionId} />
          <ActionButton variant="primary">{t('returnToAi')}</ActionButton>
        </form>
      </div>
      {takeOverState.error && <p className="text-xs text-red-600">{takeOverState.error.message}</p>}
      {returnState.error && <p className="text-xs text-red-600">{returnState.error.message}</p>}
    </div>
  );
}
