'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getPaymentReceipt } from '@/app/actions/payment-receipt';
import { actionErrorMessage } from '@/lib/errors';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReceiptButton({ paymentId }: { paymentId: string }) {
  const t = useTranslations('paymentReceipt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const result = await getPaymentReceipt(paymentId);
      if (result.error || !result.data) throw new Error(result.error ? actionErrorMessage(result.error) : t('error'));
      const labels = {
        title: t('pdf.title'), number: t('pdf.number'), receivedFrom: t('pdf.receivedFrom'), property: t('pdf.property'),
        unit: t('pdf.unit'), date: t('pdf.date'), method: t('pdf.method'), concept: t('pdf.concept'),
        reference: t('pdf.reference'), amount: t('pdf.amount'), footer: t('pdf.footer'),
      };
      const { renderReceiptPdfBlob } = await import('@/lib/receipts/receipt-pdf.tsx');
      saveBlob(await renderReceiptPdfBlob(result.data, labels), `${result.data.number}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={download} disabled={busy} className="text-xs font-medium text-brand-600 hover:text-brand-700 underline disabled:opacity-50">
        {busy ? t('generating') : t('download')}
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
