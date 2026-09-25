'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { updateAgentLiveSettingsAction } from '@/app/actions/agent-inbox';
import type { ActionResult } from '@/lib/errors';

function SaveButton() {
  const t = useTranslations('agentInbox');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? t('saving') : t('save')}
    </button>
  );
}

export interface LiveSettingsFormProps {
  whatsappEnabled: boolean;
  shadowMode: boolean;
  maxAgentTurns: number | null;
}

/** The inbox header's "go live" controls: whatsapp on/off, shadow mode, turn cap. */
export function LiveSettingsForm({ whatsappEnabled, shadowMode, maxAgentTurns }: LiveSettingsFormProps) {
  const t = useTranslations('agentInbox');
  const [enabled, setEnabled] = useState(whatsappEnabled);
  const [shadow, setShadow] = useState(shadowMode);
  const [turns, setTurns] = useState(maxAgentTurns != null ? String(maxAgentTurns) : '');
  const [state, action] = useActionState<ActionResult, FormData>(updateAgentLiveSettingsAction, {});

  return (
    <form action={action} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <input type="hidden" name="whatsapp_enabled" value={enabled ? 'true' : 'false'} />
      <input type="hidden" name="shadow_mode" value={shadow ? 'true' : 'false'} />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-slate-300"
          />
          {t('whatsappEnabled')}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={shadow}
            onChange={(e) => setShadow(e.target.checked)}
            className="rounded border-slate-300"
          />
          {t('shadowMode')}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          {t('maxAgentTurns')}
          <input
            type="number"
            name="max_agent_turns"
            min={1}
            max={200}
            value={turns}
            onChange={(e) => setTurns(e.target.value)}
            placeholder={t('unlimited')}
            className="w-20 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        <SaveButton />
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error.message}</p>}
      {!state.error && state.data !== undefined && <p className="text-xs text-green-600">{t('savedOk')}</p>}
    </form>
  );
}
