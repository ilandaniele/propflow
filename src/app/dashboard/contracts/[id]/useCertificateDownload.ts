'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { renderSignatureCertificate } from '@/lib/contracts/pdf-client';
import type { CertificateLabels } from '@/lib/contracts/certificate-document';

const CERTIFICATE_LABEL_KEYS = [
  'title', 'intro', 'contract', 'organization', 'tenant', 'property', 'term', 'signer', 'sentAt', 'viewedAt',
  'signedAt', 'ip', 'userAgent', 'documentHash', 'signatureHash', 'landlordSignature', 'tenantSignature', 'missing',
] as const satisfies readonly (keyof CertificateLabels)[];

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useCertificateDownload() {
  const t = useTranslations('contractDetail');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function download(requestId: string) {
    setError(null);
    setPendingId(requestId);
    const labels = Object.fromEntries(CERTIFICATE_LABEL_KEYS.map((key) => [key, t(`certificate.${key}`)])) as CertificateLabels;
    startTransition(async () => {
      try {
        downloadBlob(await renderSignatureCertificate(requestId, labels), `signature-certificate-${requestId.slice(0, 8)}.pdf`);
      } catch {
        setError(t('certificateError'));
      } finally {
        setPendingId(null);
      }
    });
  }

  return {
    download,
    error,
    isPending: (requestId: string) => pendingId === requestId,
    buttonLabel: (requestId: string) => (pendingId === requestId ? t('certificateLoading') : t('certificateButton')),
  };
}
