'use client';

import { useTransition, useState } from 'react';
import { matchReceiptToPayment } from '@/app/actions/finance';
import { StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { ReceiptUpload } from '@/types';

interface PendingPayment {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
}

interface Props {
  receipts: ReceiptUpload[];
  pendingPayments: PendingPayment[];
}

export function OcrReceiptsClient({ receipts, pendingPayments }: Props) {
  const [isPending, startTransition] = useTransition();
  const [matchingReceiptId, setMatchingReceiptId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  function handleMatch(receiptId: string) {
    if (!selectedPayment) return;
    const formData = new FormData();
    formData.set('receipt_id', receiptId);
    formData.set('payment_id', selectedPayment);
    startTransition(async () => {
      const result = await matchReceiptToPayment({}, formData);
      if (result.error) {
        setMessage(result.error.message);
      } else {
        setMessage('Matched successfully');
        setMatchingReceiptId(null);
        setSelectedPayment('');
      }
    });
  }

  function handleOcr(receiptId: string) {
    startTransition(async () => {
      const res = await fetch('/api/receipts/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_id: receiptId }),
      });
      if (!res.ok) {
        setMessage('OCR failed. Please try again.');
      } else {
        setMessage('OCR triggered — refresh in a moment to see results.');
      }
    });
  }

  return (
    <div className="space-y-3">
      {message && (
        <div className="p-3 bg-blue-50 text-blue-800 rounded-lg text-sm">{message}</div>
      )}
      {receipts.map((r) => (
        <div key={r.id} className="border border-slate-200 rounded-lg p-4 space-y-3 bg-white">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900 truncate max-w-xs">{r.file_path.split('/').pop()}</p>
              <p className="text-xs text-slate-500 mt-0.5">{new Date(r.created_at).toLocaleDateString()}</p>
            </div>
            <StatusPill status={r.ocr_status} />
          </div>

          {(r.ocr_status === 'extracted' || r.ocr_status === 'matched') && (
            <div className="text-xs text-slate-600 grid grid-cols-2 gap-1 bg-slate-50 rounded p-2">
              <span className="font-medium">Amount:</span>
              <span>{r.extracted_amount ? `$${r.extracted_amount}` : '—'}</span>
              <span className="font-medium">Date:</span>
              <span>{r.extracted_date ?? '—'}</span>
              <span className="font-medium">Vendor:</span>
              <span>{r.extracted_vendor ?? '—'}</span>
              <span className="font-medium">Confidence:</span>
              <span>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</span>
            </div>
          )}

          {r.ocr_error && (
            <p className="text-xs text-red-600">{r.ocr_error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(r.ocr_status === 'pending' || r.ocr_status === 'failed') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleOcr(r.id)}
                disabled={isPending}
              >
                Run OCR
              </Button>
            )}

            {r.ocr_status === 'extracted' && (
              matchingReceiptId === r.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    className="text-xs border border-slate-200 rounded px-2 py-1"
                    value={selectedPayment}
                    onChange={e => setSelectedPayment(e.target.value)}
                    aria-label="Select payment to match"
                  >
                    <option value="">Select payment…</option>
                    {pendingPayments.map(p => (
                      <option key={p.id} value={p.id}>
                        ${p.amount} — {p.paid_at.slice(0, 10)}{p.reference ? ` (${p.reference})` : ''}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => handleMatch(r.id)} disabled={isPending || !selectedPayment}>
                    Confirm Match
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMatchingReceiptId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setMatchingReceiptId(r.id)}
                  disabled={isPending}
                >
                  Match to Payment
                </Button>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
