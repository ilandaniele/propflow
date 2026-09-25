'use client';

import { useActionState, useState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { runPlaygroundTurn, type PlaygroundTurnResult } from '@/app/actions/agent-playground';
import type { ActionResult } from '@/lib/errors';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  handedOffToHuman?: boolean;
}

function SendButton() {
  const t = useTranslations('agentPlayground');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? t('sending') : t('send')}
    </button>
  );
}

export function PlaygroundClient() {
  const t = useTranslations('agentPlayground');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, action] = useActionState<ActionResult<PlaygroundTurnResult>, FormData>(runPlaygroundTurn, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Appends the action's result to the transcript as soon as it changes — done
  // during render (React's documented pattern for "adjust state when a prop
  // changes"), not in an effect, so it commits in the same render instead of
  // triggering a second one.
  const [appliedState, setAppliedState] = useState(state);
  if (state !== appliedState) {
    setAppliedState(state);
    if (state.data) {
      setTurns((prev) => [...prev, { role: 'assistant', text: state.data!.replyText, handedOffToHuman: state.data!.handedOffToHuman }]);
    } else if (state.error) {
      setTurns((prev) => [...prev, { role: 'assistant', text: t('errorGeneric') }]);
    }
  }

  function handleSubmit(formData: FormData) {
    const message = String(formData.get('message') ?? '').trim();
    if (!message) return;
    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    formRef.current?.reset();
    action(formData);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        {t('disclaimer')}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        {turns.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {turns.map((turn, i) => (
              <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-md px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words',
                    turn.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900',
                  ].join(' ')}
                >
                  <p>{turn.text}</p>
                  {turn.handedOffToHuman && (
                    <p className="text-xs mt-1 text-amber-600 font-medium">{t('handoffBadge')}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <form ref={formRef} action={handleSubmit} className="flex gap-2">
          <input
            name="message"
            type="text"
            placeholder={t('placeholder')}
            required
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <SendButton />
        </form>
      </div>
    </div>
  );
}
