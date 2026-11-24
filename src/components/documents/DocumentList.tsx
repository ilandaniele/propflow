'use client';

import { useActionState, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { deleteDocument, getDocumentUrl, getPortalDocumentUrl } from '@/app/actions/documents';
import { expiryState } from '@/lib/documents/types';
import type { DocumentRow } from '@/lib/documents/queries';
import type { ActionResult } from '@/lib/errors';

const EXPIRY_VARIANTS = { expired: 'danger', soon: 'warning' } as const;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  documents: DocumentRow[];
  mode:      'admin' | 'portal';
  today:     string;
}

export function DocumentList({ documents, mode, today }: Props) {
  const t = useTranslations('documents');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);
  const [, startOpening] = useTransition();
  const [deleteState, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(
    (_prev, formData) => deleteDocument({}, formData),
    null,
  );

  function open(id: string) {
    setOpenError(false);
    setOpeningId(id);
    startOpening(async () => {
      const formData = new FormData();
      formData.set('id', id);
      const result = await (mode === 'admin' ? getDocumentUrl : getPortalDocumentUrl)({}, formData);
      setOpeningId(null);
      if (result.data) window.location.assign(result.data.url);
      else setOpenError(true);
    });
  }

  if (documents.length === 0) return <p className="text-sm text-slate-500">{t('list.empty')}</p>;

  return (
    <div className="divide-y divide-slate-100 text-sm">
      {openError && <p role="alert" className="pb-3 text-red-600">{t('errors.open')}</p>}
      {deleteState?.error && <p role="alert" className="pb-3 text-red-600">{t('errors.delete')}</p>}
      {documents.map((document) => {
        const expiry = expiryState(document.expiresOn, today);
        return (
          <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="min-w-0">
              <span className="font-medium text-slate-900">{document.name}</span>
              <span className="text-slate-500">
                {' · '}{t(`categories.${document.category}`)}
                {mode === 'admin' && document.entityLabel && <> · {t(`entities.${document.entityType}`)}: {document.entityLabel}</>}
                {' · '}{formatSize(document.sizeBytes)}
                {document.expiresOn && <> · {t('list.expires', { date: document.expiresOn })}</>}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {expiry && <Badge variant={EXPIRY_VARIANTS[expiry]}>{t(`expiry.${expiry}`)}</Badge>}
              {mode === 'admin' && document.visibleToTenant && <Badge variant="info">{t('list.visible')}</Badge>}
              <Button type="button" size="sm" variant="secondary" onClick={() => open(document.id)} disabled={openingId === document.id}>
                {openingId === document.id ? t('list.opening') : t('list.open')}
              </Button>
              {mode === 'admin' && (
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={document.id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={deleting}>{t('list.delete')}</Button>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
