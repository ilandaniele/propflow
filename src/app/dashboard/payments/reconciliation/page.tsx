import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { activeContractOptions, listBankLines, openPaymentCandidates } from '@/lib/bank/reconciliation';
import { amountCandidates, suggestMatch } from '@/lib/bank/match-math';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadStatementForm } from './UploadStatementForm';
import { ReconciliationTable, type ReconciliationRow } from './ReconciliationTable';
import { RestoreLineButton } from './RestoreLineButton';
import { formatSoles } from './format';

export const metadata: Metadata = { title: 'Bank reconciliation' };

export default async function ReconciliationPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('bankReconciliation');

  const [unmatched, matched, ignored, candidates, contractOptions] = await Promise.all([
    listBankLines(ctx.orgId, 'unmatched'),
    listBankLines(ctx.orgId, 'matched'),
    listBankLines(ctx.orgId, 'ignored'),
    openPaymentCandidates(ctx.orgId),
    activeContractOptions(ctx.orgId),
  ]);

  const rows: ReconciliationRow[] = unmatched.map((line) => ({
    ...line,
    candidates: amountCandidates(line, candidates),
    suggestedId: suggestMatch(line, candidates)?.id ?? null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/payments" className="text-sm text-slate-500 hover:underline">{t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <UploadStatementForm />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('unmatchedTitle', { count: rows.length })}</h2>
        {rows.length === 0 ? (
          <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
        ) : (
          <ReconciliationTable rows={rows} contracts={contractOptions} />
        )}
      </section>

      {matched.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">{t('matchedTitle')}</h2>
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
            {matched.map((line) => (
              <li key={line.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span className="text-slate-600">{line.postedOn} · {line.description}</span>
                <span className="tabular-nums font-medium text-emerald-700">{formatSoles(line.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ignored.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">{t('ignoredTitle')}</h2>
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
            {ignored.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-slate-500">{line.postedOn} · {line.description} · {formatSoles(line.amount)}</span>
                <RestoreLineButton lineId={line.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
