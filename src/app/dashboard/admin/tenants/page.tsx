'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { TenantCsvImportModal } from './TenantCsvImportModal';

interface TenantRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  tenant_status: string | null;
  sync_status: string | null;
  portal_access: string | null;
  units: {
    label: string;
    properties: { name: string } | null;
  } | null;
  created_at: string;
}

function syncStatusVariant(s: string | null): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (s) {
    case 'synced':       return 'success';
    case 'pending':      return 'warning';
    case 'failed':       return 'danger';
    case 'needs_review': return 'info';
    default:             return 'default';
  }
}

function tenantStatusVariant(s: string | null): 'success' | 'default' | 'warning' {
  switch (s) {
    case 'active':   return 'success';
    case 'inactive': return 'default';
    case 'pending':  return 'warning';
    default:         return 'default';
  }
}

export default function AdminTenantsPage() {
  const t = useTranslations('adminTenants');
  const [tenants, setTenants]       = useState<TenantRow[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [syncFilter, setSyncFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const LIMIT = 20;

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)      params.set('search',      search);
      if (statusFilter) params.set('status',     statusFilter);
      if (syncFilter)  params.set('sync_status', syncFilter);
      params.set('page',  String(page));
      params.set('limit', String(LIMIT));

      const res  = await fetch(`/api/admin/tenants?${params.toString()}`);
      const json = await res.json() as { tenants: TenantRow[]; total: number };
      setTenants(json.tenants ?? []);
      setTotal(json.total ?? 0);
    } catch {
      // silent — UI shows empty state
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, syncFilter, page]);

  useEffect(() => { void fetchTenants(); }, [fetchTenants]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, syncFilter]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{total} total</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/admin/tenants/import/template"
            className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            {t('downloadTemplate')}
          </a>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            {t('importTenants')}
          </Button>
          <Link href="/dashboard/admin/imports" className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            {t('viewHistory')}
          </Link>
          <Link href="/dashboard/admin/tenants/new">
            <Button variant="primary" size="sm">+ {t('newTenant')}</Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">{t('allStatuses')}</option>
          <option value="active">{t('tenantStatus.active')}</option>
          <option value="inactive">{t('tenantStatus.inactive')}</option>
          <option value="pending">{t('tenantStatus.pending')}</option>
        </select>
        <select
          value={syncFilter}
          onChange={e => setSyncFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">{t('allSync')}</option>
          <option value="synced">{t('syncStatus.synced')}</option>
          <option value="pending">{t('syncStatus.pending')}</option>
          <option value="failed">{t('syncStatus.failed')}</option>
          <option value="needs_review">{t('syncStatus.needs_review')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">{t('noTenants')}</p>
          </div>
        ) : (
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colName')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colEmail')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colPropertyUnit')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colStatus')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colSync')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colPortal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map(tenant => {
                const unit = tenant.units;
                const unitLabel = unit
                  ? `${unit.properties?.name ?? ''} — ${unit.label}`
                  : null;
                return (
                  <tr
                    key={tenant.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => window.location.href = `/dashboard/admin/tenants/${tenant.id}`}
                  >
                    <td className="px-5 py-4 font-medium text-slate-900 text-sm">
                      {tenant.full_name ?? '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {tenant.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unitLabel ?? <span className="text-slate-300">{t('unassigned')}</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={tenantStatusVariant(tenant.tenant_status)}>
                        {tenant.tenant_status ? t(`tenantStatus.${tenant.tenant_status}` as Parameters<typeof t>[0]) : '—'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <Badge variant={syncStatusVariant(tenant.sync_status)}>
                        {tenant.sync_status ? t(`syncStatus.${tenant.sync_status}` as Parameters<typeof t>[0]) : '—'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell">
                      {tenant.portal_access ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV Import Modal */}
      <TenantCsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { void fetchTenants(); }}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {t('pageInfo', { page, total: totalPages, count: total })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              {t('prev')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
