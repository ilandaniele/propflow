'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Badge';
import type { SignatureRequestRow } from '@/lib/contracts/signature-requests';
import { useCertificateDownload } from './useCertificateDownload';

function Evidence({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <dt className="text-slate-500 sm:w-36 shrink-0">{label}</dt>
      <dd className={mono ? 'font-mono text-xs break-all' : ''}>{value}</dd>
    </div>
  );
}

export function SignatureEvidenceList({ requests }: { requests: SignatureRequestRow[] }) {
  const t = useTranslations('contractDetail');
  const certificate = useCertificateDownload();

  if (requests.length === 0) return <p className="text-sm text-slate-500">{t('noSignatures')}</p>;

  return (
    <div className="divide-y divide-slate-100 text-sm">
      {certificate.error && <p role="alert" className="pb-3 text-red-600">{certificate.error}</p>}
      {requests.map((request) => (
        <div key={request.id} className="py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-900">{request.signerEmail}</span>
            <div className="flex items-center gap-2">
              <StatusPill status={request.status} />
              {request.status === 'signed' && (
                <Button type="button" size="sm" variant="secondary" onClick={() => certificate.download(request.id)} disabled={certificate.isPending(request.id)}>
                  {certificate.buttonLabel(request.id)}
                </Button>
              )}
            </div>
          </div>
          <dl className="space-y-1 text-slate-700">
            <Evidence label={t('certificate.sentAt')} value={request.sentAt} />
            <Evidence label={t('certificate.viewedAt')} value={request.viewedAt} />
            <Evidence label={t('certificate.signedAt')} value={request.signedAt} />
            <Evidence label={t('certificate.ip')} value={request.signedIp} />
            <Evidence label={t('certificate.documentHash')} value={request.documentSha256} mono />
          </dl>
        </div>
      ))}
    </div>
  );
}
