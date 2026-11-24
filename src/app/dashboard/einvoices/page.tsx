import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listEinvoices, listEmittableCharges } from '@/lib/einvoice/queries';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { EmitEinvoiceForm } from './EmitEinvoiceForm';

export const metadata: Metadata = { title: 'E-invoices' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning',
  accepted_sandbox: 'info',
  sent: 'info',
  accepted: 'success',
  rejected: 'danger',
  error: 'danger',
};

const formatPen = (amount: string) => `S/ ${Number(amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;

export default async function EinvoicesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const page = Math.max(1, Math.floor(Number((await searchParams).page)) || 1);
  const [t, { items, hasMore }, charges] = await Promise.all([
    getTranslations('einvoices'),
    listEinvoices(ctx.orgId, page),
    listEmittableCharges(ctx.orgId),
  ]);
  const statusLabel = (status: string) => {
    const key = `status.${status}`;
    return t(key);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('emitTitle')}</h2>
        {charges.length === 0 ? (
          <EmptyState title={t('noChargesTitle')} description={t('noChargesDesc')} />
        ) : (
          <EmitEinvoiceForm
            charges={charges.map((charge) => ({
              id: charge.id,
              label: [charge.tenantName, charge.period, formatPen(charge.amount)].filter(Boolean).join(' · '),
              customerName: charge.tenantName,
              customerDni: charge.tenantDni && /^\d{8}$/.test(charge.tenantDni) ? charge.tenantDni : '',
            }))}
          />
        )}
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3">{t('colNumber')}</th>
                <th className="px-5 py-3 hidden sm:table-cell">{t('colCustomer')}</th>
                <th className="px-5 py-3">{t('colTotal')}</th>
                <th className="px-5 py-3 hidden md:table-cell">{t('colIgv')}</th>
                <th className="px-5 py-3 hidden lg:table-cell">{t('colDate')}</th>
                <th className="px-5 py-3">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {items.map((doc) => (
                <tr key={doc.id}>
                  <td className="px-5 py-4 font-medium text-slate-900">
                    {doc.pdfUrl?.startsWith('https://') ? (
                      <a href={doc.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline">{doc.series}-{doc.number}</a>
                    ) : `${doc.series}-${doc.number}`}
                  </td>
                  <td className="px-5 py-4 text-slate-500 hidden sm:table-cell">
                    {doc.customerName}{doc.customerDocNumber ? ` (${doc.customerDocNumber})` : ''}
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-900">{formatPen(doc.total)}</td>
                  <td className="px-5 py-4 text-slate-500 hidden md:table-cell">{formatPen(doc.igv)}</td>
                  <td className="px-5 py-4 text-slate-500 hidden lg:table-cell">{doc.createdAt.toISOString().slice(0, 10)}</td>
                  <td className="px-5 py-4">
                    <span title={doc.error ?? undefined}>
                      <Badge variant={STATUS_BADGE[doc.status] ?? 'default'}>{statusLabel(doc.status)}</Badge>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex justify-between text-sm" aria-label={t('pagination')}>
        {page > 1 ? <Link href={`/dashboard/einvoices?page=${page - 1}`} className="underline">{t('previous')}</Link> : <span />}
        {hasMore && <Link href={`/dashboard/einvoices?page=${page + 1}`} className="underline">{t('next')}</Link>}
      </nav>
    </div>
  );
}
