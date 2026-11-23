import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listSuppliers } from '@/lib/suppliers/suppliers';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupplierForm } from './SupplierForm';
import { ActiveToggle } from './ActiveToggle';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const [rows, t] = await Promise.all([listSuppliers(ctx.orgId), getTranslations('suppliers')]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('newTitle')}</CardTitle></CardHeader>
        <SupplierForm />
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((supplier) => (
            <li key={supplier.id} className={`bg-white rounded-xl border border-slate-200 p-4 ${supplier.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {supplier.name}
                    {!supplier.active && <span className="ml-2 text-xs font-medium text-slate-500">{t('inactive')}</span>}
                  </p>
                  <p className="text-sm text-slate-600">{t(`trades.${supplier.trade}`)}</p>
                  <p className="text-sm text-slate-500">{[supplier.phone, supplier.email].filter(Boolean).join(' · ') || t('noContact')}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm text-slate-600 tabular-nums">{t('jobs', { open: Number(supplier.openJobs), total: Number(supplier.totalJobs) })}</p>
                  <ActiveToggle id={supplier.id} active={supplier.active} />
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">{t('edit')}</summary>
                <div className="mt-3">
                  <SupplierForm supplier={supplier} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
