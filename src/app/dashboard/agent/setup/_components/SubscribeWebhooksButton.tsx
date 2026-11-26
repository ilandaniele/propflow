'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { subscribeWhatsAppWebhooks } from '@/app/actions/agent-templates';
import { actionErrorMessage } from '@/lib/errors';

/** Calls Meta's subscribed_apps so the WABA starts delivering inbound messages to our webhook. */
export function SubscribeWebhooksButton() {
  const t = useTranslations('agentSetup');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await subscribeWhatsAppWebhooks();
      setMessage(result.error
        ? { ok: false, text: actionErrorMessage(result.error) }
        : { ok: true, text: t('whatsappSubscribeDone') });
    });
  };

  return (
    <div className="mt-1.5 flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="px-3 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
      >
        {pending ? t('whatsappSubscribing') : t('whatsappSubscribeButton')}
      </button>
      {message && <p className={message.ok ? 'text-xs text-green-700' : 'text-xs text-red-600'}>{message.text}</p>}
    </div>
  );
}
