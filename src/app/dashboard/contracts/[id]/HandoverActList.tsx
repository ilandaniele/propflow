'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { sendHandoverActForSignature } from '@/app/actions/handover';
import { generateAndSaveHandoverPdf } from '@/lib/contracts/pdf-client';
import { INVENTORY_CONDITIONS } from '@/lib/contracts/handover-types';
import type { HandoverActRow } from '@/lib/contracts/handover';
import type { HandoverLabels } from '@/lib/contracts/handover-document';
import type { ActionResult } from '@/lib/errors';
import { useCertificateDownload } from './useCertificateDownload';

const PDF_LABEL_KEYS = [
  'contract', 'organization', 'tenant', 'property', 'date', 'item', 'quantity', 'condition', 'notes',
  'generalNotes', 'landlordSignature', 'tenantSignature', 'missing',
] as const satisfies readonly Exclude<keyof HandoverLabels, 'title' | 'conditions'>[];

const STATUS_VARIANTS = { draft: 'default', pending_signature: 'pending', signed: 'success' } as const;

export function HandoverActList({ acts, tenantEmail }: { acts: HandoverActRow[]; tenantEmail: string | null }) {
  const t = useTranslations('handover');
  const router = useRouter();
  const certificate = useCertificateDownload();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [, startGenerating] = useTransition();
  const [sendState, sendAction, sending] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => sendHandoverActForSignature(prev ?? {}, formData),
    null,
  );

  function pdfLabels(act: HandoverActRow): HandoverLabels {
    return {
      ...(Object.fromEntries(PDF_LABEL_KEYS.map((key) => [key, t(`pdf.${key}`)])) as Omit<HandoverLabels, 'title' | 'conditions'>),
      title:      t(`pdf.title.${act.kind}`),
      conditions: Object.fromEntries(INVENTORY_CONDITIONS.map((c) => [c, t(`conditions.${c}`)])) as HandoverLabels['conditions'],
    };
  }

  function generate(act: HandoverActRow) {
    setGenerateError(null);
    setGeneratingId(act.id);
    startGenerating(async () => {
      try {
        await generateAndSaveHandoverPdf(act.id, pdfLabels(act));
        router.refresh();
      } catch {
        setGenerateError(t('act.generateError'));
      } finally {
        setGeneratingId(null);
      }
    });
  }

  if (acts.length === 0) return <p className="text-sm text-slate-500">{t('act.empty')}</p>;

  return (
    <div className="divide-y divide-slate-100 text-sm">
      {[generateError, certificate.error].filter(Boolean).map((message) => (
        <p key={message} role="alert" className="pb-3 text-red-600">{message}</p>
      ))}
      {sendState?.error && <p role="alert" className="pb-3 text-red-600">{t('act.sendError')}</p>}
      {acts.map((act) => (
        <div key={act.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span>
            <span className="font-medium text-slate-900">{t(`kinds.${act.kind}`)}</span>
            <span className="text-slate-500"> · {act.createdAt.slice(0, 10)} · {t('act.itemCount', { count: act.itemCount })}</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANTS[act.status as keyof typeof STATUS_VARIANTS] ?? 'default'}>{t(`statuses.${act.status}`)}</Badge>
            {act.status === 'draft' && (
              <Button type="button" size="sm" variant="secondary" onClick={() => generate(act)} disabled={generatingId === act.id}>
                {generatingId === act.id ? t('act.generating') : act.hasDocument ? t('act.regenerate') : t('act.generate')}
              </Button>
            )}
            {act.status === 'draft' && act.hasDocument && (
              <form action={sendAction}>
                <input type="hidden" name="handover_act_id" value={act.id} />
                <Button type="submit" size="sm" disabled={!tenantEmail || sending}>{sending ? t('act.sending') : t('act.send')}</Button>
              </form>
            )}
            {act.signedRequestId && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => certificate.download(act.signedRequestId!)}
                disabled={certificate.isPending(act.signedRequestId)}
              >
                {certificate.buttonLabel(act.signedRequestId)}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
