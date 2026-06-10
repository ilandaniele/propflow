'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SkeletonTable, SkeletonStats } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CsvImportModal } from './CsvImportModal';

// ── Types ────────────────────────────────────────────────────────────────────

interface PaymentSummary {
  total_paid: number;
  total_pending: number;
  total_overdue: number;
  current_balance: number;
  currency: string;
}

interface Movement {
  id: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  due_date: string | null;
  status: string;
  method: string | null;
  reference: string | null;
  period_month: string | null;
  movement_type: string;
  receipt_url: string | null;
  notes: string | null;
  property_name: string | null;
  unit_label: string | null;
  running_balance: number;
  is_credit: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusVariant(status: string): 'warning' | 'success' | 'info' | 'danger' | 'default' {
  switch (status) {
    case 'pending':      return 'warning';
    case 'approved':     return 'success';
    case 'under_review': return 'info';
    case 'rejected':     return 'danger';
    default:             return 'default';
  }
}

function fmtAmount(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentsClient() {
  const t = useTranslations('tenantPayments');
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'paid_at' | 'due_date' | 'amount'>('paid_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const LIMIT = 20;

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch('/api/tenant/payments/summary');
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (filterStatus) q.set('status', filterStatus);
      if (filterPeriod) q.set('period', filterPeriod);
      if (filterDateFrom) q.set('date_from', filterDateFrom);
      if (filterDateTo) q.set('date_to', filterDateTo);

      const res = await fetch(`/api/tenant/payments/movements?${q}`);
      if (res.ok) {
        const data = await res.json();
        setMovements(data.movements ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoadingMovements(false);
    }
  }, [page, sortBy, sortDir, filterStatus, filterPeriod, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  function toggleSort(col: 'paid_at' | 'due_date' | 'amount') {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-brand-600 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const currency = summary?.currency ?? 'PEN';
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <div className="flex gap-2">
          <a
            href="/api/tenant/payments/import/template"
            className="inline-flex items-center h-9 px-3 text-sm font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            {t('downloadTemplate')}
          </a>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            {t('importCsv')}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {loadingSummary ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t('summaryTotalPaid'),  value: fmtAmount(summary?.total_paid ?? 0, currency),       color: 'text-green-600' },
            { label: t('summaryPending'),    value: fmtAmount(summary?.total_pending ?? 0, currency),    color: 'text-yellow-600' },
            { label: t('summaryOverdue'),    value: fmtAmount(summary?.total_overdue ?? 0, currency),    color: 'text-red-600' },
            { label: t('summaryBalance'),    value: fmtAmount(summary?.current_balance ?? 0, currency),  color: 'text-slate-900' },
          ].map(({ label, value, color }) => (
            <Card key={label} padding="md">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card padding="sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('filterStatus')}</label>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">{t('filterAllStatuses')}</option>
              <option value="pending">{t('paymentStatus.pending')}</option>
              <option value="approved">{t('paymentStatus.approved')}</option>
              <option value="under_review">{t('paymentStatus.under_review')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('filterPeriod')}</label>
            <input
              type="month"
              value={filterPeriod}
              onChange={e => { setFilterPeriod(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('filterFrom')}</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('filterTo')}</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {(filterStatus || filterPeriod || filterDateFrom || filterDateTo) && (
            <button
              onClick={() => { setFilterStatus(''); setFilterPeriod(''); setFilterDateFrom(''); setFilterDateTo(''); setPage(1); }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              {t('clearFilters')}
            </button>
          )}
        </div>
      </Card>

      {/* Movements table */}
      <Card padding="none">
        <CardHeader className="px-5 pt-5 pb-4">
          <CardTitle>{t('sectionMovements')}</CardTitle>
          {total > 0 && <span className="text-xs text-slate-400">{t('records', { count: total })}</span>}
        </CardHeader>
        {loadingMovements ? (
          <SkeletonTable rows={5} cols={7} />
        ) : movements.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title={t('noPayments')} description={t('noPaymentsDesc')} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th
                      className="px-4 py-3 text-left font-medium text-slate-600 cursor-pointer select-none"
                      onClick={() => toggleSort('paid_at')}
                    >
                      {t('colDate')} <SortIcon col="paid_at" />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{t('colDescription')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{t('colType')}</th>
                    <th
                      className="px-4 py-3 text-right font-medium text-slate-600 cursor-pointer select-none"
                      onClick={() => toggleSort('amount')}
                    >
                      {t('colDebit')} <SortIcon col="amount" />
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('colCredit')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('colBalance')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{t('colStatus')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{t('colReference')}</th>
                    <th className="px-4 py-3 text-center font-medium text-slate-600">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {fmtDate(m.paid_at ?? m.due_date)}
                      </td>
                      <td className="px-4 py-3 text-slate-900 max-w-[200px]">
                        <span className="truncate block">{m.notes ?? m.period_month ?? '—'}</span>
                        {m.property_name && (
                          <span className="text-xs text-slate-400">{m.property_name}{m.unit_label ? ` · ${m.unit_label}` : ''}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {t(`movementTypes.${m.movement_type}` as Parameters<typeof t>[0]) || m.movement_type}
                      </td>
                      <td className="px-4 py-3 text-right text-red-700 font-medium whitespace-nowrap">
                        {!m.is_credit ? fmtAmount(m.amount, m.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-green-700 font-medium whitespace-nowrap">
                        {m.is_credit ? fmtAmount(m.amount, m.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                        <span className={m.running_balance > 0 ? 'text-red-600' : 'text-green-600'}>
                          {fmtAmount(m.running_balance, m.currency)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(m.status)}>
                          {t(`paymentStatus.${m.status}` as Parameters<typeof t>[0]) || m.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{m.reference ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {m.receipt_url ? (
                          <a
                            href={m.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('receiptTitle')}
                            className="text-brand-600 hover:text-brand-700 text-xs underline"
                          >
                            {t('receipt')}
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100">
                <span className="text-xs text-slate-400">
                  {t('pageInfo', { page, total: totalPages })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    {t('prev')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    {t('next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* CSV Import Modal */}
      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { fetchSummary(); fetchMovements(); }}
        checkUrl="/api/tenant/payments/import/check"
        importUrl="/api/tenant/payments/import"
        importType="payment"
      />
    </div>
  );
}
