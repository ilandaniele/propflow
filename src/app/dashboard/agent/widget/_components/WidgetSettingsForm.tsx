'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { updateWidgetSettings } from '@/app/actions/agent-widget';
import type { ActionResult } from '@/lib/errors';

function SaveButton() {
  const t = useTranslations('agentWidget');
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

interface FieldErrors {
  origins?: string[];
  daily_message_cap?: string[];
  daily_session_cap?: string[];
  accent_color?: string[];
  whatsapp_display_phone?: string[];
}

export interface WidgetSettingsFormProps {
  enabled: boolean;
  allowedOrigins: string[];
  dailyMessageCap: number;
  dailySessionCap: number;
  greeting: string;
  accentColor: string;
  whatsappDisplayPhone: string | null;
}

/** The web widget's on/off switch, allowed origins, daily caps, greeting, accent colour and WhatsApp display number. */
export function WidgetSettingsForm({
  enabled,
  allowedOrigins,
  dailyMessageCap,
  dailySessionCap,
  greeting,
  accentColor,
  whatsappDisplayPhone,
}: WidgetSettingsFormProps) {
  const t = useTranslations('agentWidget');
  const [widgetEnabled, setWidgetEnabled] = useState(enabled);
  const [state, action] = useActionState<ActionResult, FormData>(updateWidgetSettings, {});
  const fieldErrors = (state.error?.details as { fieldErrors?: FieldErrors } | undefined)?.fieldErrors;

  return (
    <form action={action} className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <input type="hidden" name="enabled" value={widgetEnabled ? 'true' : 'false'} />

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={widgetEnabled}
          onChange={(e) => setWidgetEnabled(e.target.checked)}
          className="rounded border-slate-300"
        />
        {t('widgetEnabled')}
      </label>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="origins">
          {t('allowedOrigins')}
        </label>
        <textarea
          id="origins"
          name="origins"
          rows={4}
          defaultValue={allowedOrigins.join('\n')}
          placeholder="https://misitio.com"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">{t('allowedOriginsHint')}</p>
        {fieldErrors?.origins && <p className="text-xs text-red-600 mt-1">{fieldErrors.origins[0]}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="daily_message_cap">
            {t('dailyMessageCap')}
          </label>
          <input
            id="daily_message_cap"
            name="daily_message_cap"
            type="number"
            min={1}
            max={5000}
            defaultValue={dailyMessageCap}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {fieldErrors?.daily_message_cap && <p className="text-xs text-red-600 mt-1">{fieldErrors.daily_message_cap[0]}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="daily_session_cap">
            {t('dailySessionCap')}
          </label>
          <input
            id="daily_session_cap"
            name="daily_session_cap"
            type="number"
            min={1}
            max={5000}
            defaultValue={dailySessionCap}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {fieldErrors?.daily_session_cap && <p className="text-xs text-red-600 mt-1">{fieldErrors.daily_session_cap[0]}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="greeting">
          {t('greeting')}
        </label>
        <input
          id="greeting"
          name="greeting"
          type="text"
          maxLength={2000}
          defaultValue={greeting}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="accent_color">
          {t('accentColor')}
        </label>
        <input
          id="accent_color"
          name="accent_color"
          type="text"
          placeholder="#2563eb"
          defaultValue={accentColor}
          className="w-40 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
        />
        {fieldErrors?.accent_color && <p className="text-xs text-red-600 mt-1">{fieldErrors.accent_color[0]}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="whatsapp_display_phone">
          {t('whatsappDisplayPhone')}
        </label>
        <input
          id="whatsapp_display_phone"
          name="whatsapp_display_phone"
          type="text"
          placeholder="+51987654321"
          defaultValue={whatsappDisplayPhone ?? ''}
          className="w-56 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">{t('whatsappDisplayPhoneHint')}</p>
        {fieldErrors?.whatsapp_display_phone && (
          <p className="text-xs text-red-600 mt-1">{fieldErrors.whatsapp_display_phone[0]}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SaveButton />
        {state.error && !fieldErrors && <p className="text-xs text-red-600">{state.error.message}</p>}
        {!state.error && state.data !== undefined && <p className="text-xs text-green-600">{t('savedOk')}</p>}
      </div>
    </form>
  );
}
