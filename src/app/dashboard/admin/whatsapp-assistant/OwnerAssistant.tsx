'use client';

import { useActionState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { requestOwnerLinkCode, unlinkOwnerAssistant } from '@/app/actions/owner-assistant';
import type { AssistantActivity } from '@/lib/owner-assistant/activity';

const BUTTON = 'rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

function LinkForm() {
  const t = useTranslations('ownerAssistant');
  const [state, formAction, pending] = useActionState(requestOwnerLinkCode, null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-slate-700">{t('phoneLabel')}</span>
          <input name="phone" type="tel" required placeholder="+51 987 654 321" className="rounded-lg border border-slate-200 px-2 py-1.5" />
        </label>
        <button type="submit" disabled={pending} className={BUTTON}>{pending ? t('generating') : t('generate')}</button>
      </form>
      {state?.error && (
        <p role="alert" className="text-red-600">{state.error.code === 'CONFLICT' ? t('phoneTaken') : t('error')}</p>
      )}
      {state?.data && (
        <div className="rounded-lg bg-slate-50 p-3 space-y-1">
          <p>{t('sendThis')}</p>
          <p className="font-mono text-lg font-semibold text-slate-900">VINCULAR {state.data.code}</p>
          <p className="text-xs text-slate-500">{t('expires', { time: new Date(state.data.expiresAt).toLocaleTimeString() })}</p>
        </div>
      )}
    </div>
  );
}

function Linked({ phone }: { phone: string }) {
  const t = useTranslations('ownerAssistant');
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 p-3">
      <p className="text-green-800">{t('linkedTo', { phone })}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await unlinkOwnerAssistant(); })}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
      >
        {t('unlink')}
      </button>
    </div>
  );
}

export function OwnerAssistant({ linkedPhone, activity, voiceEnabled }: { linkedPhone: string | null; activity: AssistantActivity[]; voiceEnabled: boolean }) {
  const t = useTranslations('ownerAssistant');

  return (
    <div className="space-y-5 text-sm">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-slate-500">{t('description')}</p>
      </div>
      {linkedPhone ? <Linked phone={linkedPhone} /> : <LinkForm />}
      <div>
        <h2 className="font-semibold text-slate-900">{t('commandsTitle')}</h2>
        <ul className="mt-1 list-disc pl-5 text-slate-600 space-y-1">
          <li><code>GASTO 120 pintura</code> — {t('cmdExpense')}</li>
          <li><code>PAGO 1500 Juan Pérez</code> — {t('cmdPayment')}</li>
          <li>{t('cmdPhoto')}</li>
          <li>{voiceEnabled ? t('cmdVoice') : t('cmdVoiceOff')}</li>
        </ul>
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">{t('activityTitle')}</h2>
        {activity.length === 0 ? (
          <p className="text-slate-500">{t('noActivity')}</p>
        ) : (
          <ul className="divide-y divide-slate-100" role="list">
            {activity.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 py-2">
                <span className="text-slate-700">{t.has(`kinds.${row.kind}`) ? t(`kinds.${row.kind}`) : row.kind} · {row.outcome}</span>
                <time className="text-xs text-slate-500" dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
