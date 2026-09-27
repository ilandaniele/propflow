'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { syncWhatsAppTemplates } from '@/app/actions/agent-templates';
import { actionErrorMessage } from '@/lib/errors';
import type { TemplateStatusRow } from '@/lib/whatsapp/meta-templates-api';

export interface TemplatesSectionProps {
  templates: TemplateStatusRow[];
  /** Disabled (with an explanation) until WhatsApp's own env vars + channel row are in place, or while templates couldn't be fetched from Meta. */
  canSync: boolean;
  /** Set when the initial status fetch from Meta failed — never contains the access token. */
  fetchError?: string | null;
}

/** Table of WhatsApp templates (from getWhatsAppTemplateStatus) + a button that submits them to Meta via syncWhatsAppTemplates. */
export function TemplatesSection({ templates, canSync, fetchError }: TemplatesSectionProps) {
  const t = useTranslations('agentSetup');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hasRejected = templates.some((tpl) => tpl.remoteStatus === 'REJECTED');

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      const result = await syncWhatsAppTemplates();
      if (result.error) {
        setError(actionErrorMessage(result.error));
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">{t('templatesTitle')}</h3>
      <p className="text-xs text-slate-500">{t('templatesHint')}</p>

      {templates.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-3">{t('templatesColName')}</th>
                <th className="py-1 pr-3">{t('templatesColCategory')}</th>
                <th className="py-1 pr-3">{t('templatesColStatus')}</th>
                <th className="py-1">{t('templatesColError')}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.name} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">{tpl.name}</td>
                  <td className="py-1.5 pr-3 text-slate-600">{tpl.category}</td>
                  <td className="py-1.5 pr-3 text-slate-600">
                    {tpl.remoteStatus}
                    {tpl.languageWarning && <p className="text-amber-700 text-xs mt-0.5">{tpl.languageWarning}</p>}
                  </td>
                  <td className="py-1.5 text-red-600 text-xs">{tpl.rejectedReason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">{t('templatesEmptyState')}</p>
      )}

      {fetchError && <p className="text-xs text-red-600">{t('templatesFetchErrorHint', { error: fetchError })}</p>}
      {hasRejected && <p className="text-xs text-amber-700">{t('templatesRejectedHint')}</p>}
      {!canSync && !fetchError && <p className="text-xs text-amber-700">{t('templatesDisabledHint')}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canSync || pending}
          onClick={handleSync}
          className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
        >
          {pending ? t('templatesSyncing') : t('templatesSyncButton')}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
