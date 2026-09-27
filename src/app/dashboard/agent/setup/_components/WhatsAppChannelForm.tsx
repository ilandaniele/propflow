'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { saveWhatsAppChannel } from '@/app/actions/agent-setup';
import { useSettingsAction } from '@/app/dashboard/agent/settings/_components/useSettingsAction';

export interface WhatsAppChannelFormProps {
  phoneNumberId: string | null;
  displayPhoneE164: string | null;
}

/** The org's whatsapp org_channels row — Phone number ID + display number. No screen existed for this before item 2. */
export function WhatsAppChannelForm({ phoneNumberId, displayPhoneE164 }: WhatsAppChannelFormProps) {
  const t = useTranslations('agentSetup');
  const [phoneNumberIdInput, setPhoneNumberIdInput] = useState(phoneNumberId ?? '');
  const [displayPhoneInput, setDisplayPhoneInput] = useState(displayPhoneE164 ?? '');
  const [warning, setWarning] = useState<string | null>(null);
  const { run, error, saving, savedAt } = useSettingsAction();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">{t('whatsappChannelFormTitle')}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="setup_phone_number_id">
            {t('phoneNumberIdField')}
          </label>
          <input
            id="setup_phone_number_id"
            type="text"
            value={phoneNumberIdInput}
            onChange={(e) => setPhoneNumberIdInput(e.target.value)}
            placeholder="123456789012345"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="setup_display_phone">
            {t('displayPhoneField')}
          </label>
          <input
            id="setup_display_phone"
            type="text"
            value={displayPhoneInput}
            onChange={(e) => setDisplayPhoneInput(e.target.value)}
            placeholder="+51987654321"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setWarning(null);
            const result = await run(() =>
              saveWhatsAppChannel({
                phoneNumberId: phoneNumberIdInput.trim(),
                displayPhoneE164: displayPhoneInput.trim(),
              })
            );
            if (result?.data?.warning) setWarning(result.data.warning);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? t('saving') : t('save')}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!error && savedAt !== null && <p className="text-xs text-green-600">{t('savedOk')}</p>}
      </div>
      {!error && warning && <p className="text-xs text-amber-700">{warning}</p>}
    </div>
  );
}
