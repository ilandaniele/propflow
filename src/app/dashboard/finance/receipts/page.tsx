import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { OcrReceiptsClient } from './OcrReceiptsClient';
import type { ReceiptUpload } from '@/types';

export default async function OcrReceiptsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations('ocrReceipts');

  const { data: receipts } = await supabase
    .from('receipt_uploads')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch pending payments for match picker
  const { data: pendingPayments } = await supabase
    .from('payments')
    .select('id, amount, paid_at, reference')
    .eq('org_id', ctx.orgId)
    .eq('status', 'pending')
    .order('paid_at', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        <p className="mt-0.5 text-xs text-amber-600">{t('aiWarning')}</p>
      </div>

      {(receipts ?? []).length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <OcrReceiptsClient
          receipts={(receipts ?? []) as ReceiptUpload[]}
          pendingPayments={pendingPayments ?? []}
        />
      )}
    </div>
  );
}
