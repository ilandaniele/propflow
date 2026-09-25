'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { rotateWidgetKey } from '@/app/actions/agent-widget';
import type { ActionResult } from '@/lib/errors';

function RotateButton() {
  const t = useTranslations('agentWidget');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? t('rotating') : t('rotateKey')}
    </button>
  );
}

/** Issues a new public key, invalidating any embed snippet built with the old one. */
export function RotateKeyForm() {
  const t = useTranslations('agentWidget');
  const [state, action] = useActionState<ActionResult, FormData>(rotateWidgetKey, {});

  return (
    <form action={action} className="flex items-center gap-3">
      <RotateButton />
      {state.error && <p className="text-xs text-red-600">{state.error.message}</p>}
      {!state.error && state.data !== undefined && <p className="text-xs text-green-600">{t('rotatedOk')}</p>}
    </form>
  );
}
