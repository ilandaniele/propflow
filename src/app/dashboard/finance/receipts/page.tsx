import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { receiptUploads, payments as paymentsTable } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { OcrReceiptsClient } from './OcrReceiptsClient';
import type { ReceiptUpload } from '@/types';

export default async function OcrReceiptsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('ocrReceipts');

  const [receipts, pendingPayments] = await Promise.all([
    db
      .select()
      .from(receiptUploads)
      .where(eq(receiptUploads.orgId, ctx.orgId))
      .orderBy(desc(receiptUploads.createdAt))
      .limit(50),
    db
      .select({ id: paymentsTable.id, amount: paymentsTable.amount, paidAt: paymentsTable.paidAt, reference: paymentsTable.reference })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'pending')))
      .orderBy(desc(paymentsTable.paidAt))
      .limit(50),
  ]);

  const pendingPaymentsForClient = pendingPayments.map((p) => ({
    id:        p.id,
    amount:    Number(p.amount),
    paid_at:   p.paidAt ? String(p.paidAt) : '',
    reference: p.reference,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        <p className="mt-0.5 text-xs text-amber-600">{t('aiWarning')}</p>
      </div>

      {receipts.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <OcrReceiptsClient
          receipts={receipts as unknown as ReceiptUpload[]}
          pendingPayments={pendingPaymentsForClient}
        />
      )}
    </div>
  );
}
