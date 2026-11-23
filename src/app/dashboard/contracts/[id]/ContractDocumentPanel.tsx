'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { sendSignatureRequest } from '@/app/actions/contractDoc';
import { generateAndSaveContractPdf } from '@/lib/contracts/pdf-client';
import type { ActionResult } from '@/lib/errors';

interface Props {
  contractId: string;
  templates: { id: string; name: string }[];
  documentLink: string | null;
  tenantEmail: string | null;
}

export function ContractDocumentPanel({ contractId, templates, documentLink, tenantEmail }: Props) {
  const t = useTranslations('contractDetail');
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [sendState, sendAction, sending] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => sendSignatureRequest(prev ?? {}, formData),
    null,
  );

  function generate() {
    setGenerateError(null);
    startGenerating(async () => {
      try {
        await generateAndSaveContractPdf(contractId, templateId);
        router.refresh();
      } catch {
        setGenerateError(t('generateError'));
      }
    });
  }

  if (templates.length === 0) {
    return <p className="text-sm text-slate-500">{t('noTemplates')}</p>;
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">{t('template')}</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 bg-white"
          >
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
        <Button type="button" onClick={generate} disabled={generating || !templateId}>
          {generating ? t('generating') : documentLink ? t('regenerate') : t('generate')}
        </Button>
        {documentLink && (
          <a href={documentLink} target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-brand-700 underline">
            {t('viewPdf')}
          </a>
        )}
      </div>
      {generateError && <p role="alert" className="text-red-600">{generateError}</p>}

      <form action={sendAction} className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <input type="hidden" name="contract_id" value={contractId} />
        <Button type="submit" variant="secondary" disabled={!documentLink || !tenantEmail || sending}>
          {sending ? t('sending') : t('sendForSignature')}
        </Button>
        <span className="text-slate-500">
          {!documentLink ? t('needsPdf') : tenantEmail ? t('sendHint', { email: tenantEmail }) : t('needsEmail')}
        </span>
        {sendState?.error && <p role="alert" className="w-full text-red-600">{t('sendError')}</p>}
        {sendState && !sendState.error && <p role="status" className="w-full text-green-700">{t('sent')}</p>}
      </form>
    </div>
  );
}
