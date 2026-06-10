'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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

function syncStatusLabel(s: string | null): string {
  switch (s) {
    case 'synced':       return 'Sincronizado';
    case 'pending':      return 'Pendiente';
    case 'failed':       return 'Error';
    case 'needs_review': return 'Revisar';
    default:             return s ?? '—';
  }
}

function tenantStatusLabel(s: string | null): string {
  switch (s) {
    case 'active':   return 'Activo';
    case 'inactive': return 'Inactivo';
    case 'pending':  return 'Pendiente';
    default:         return s ?? '—';
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
          <h1 className="text-2xl font-bold text-slate-900">Inquilinos</h1>
          <p className="text-sm text-slate-500 mt-1">{total} total</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/admin/tenants/import/template"
            className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            Descargar Plantilla
          </a>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            Importar Inquilinos
          </Button>
          <Link href="/dashboard/admin/imports" className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            Ver importaciones
          </Link>
          <Link href="/dashboard/admin/tenants/new">
            <Button variant="primary" size="sm">+ Nuevo inquilino</Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="inactive">Inactivo</option>
          <option value="pending">Pendiente</option>
        </select>
        <select
          value={syncFilter}
          onChange={e => setSyncFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Todo sync</option>
          <option value="synced">Sincronizado</option>
          <option value="pending">Pendiente</option>
          <option value="failed">Error</option>
          <option value="needs_review">Revisar</option>
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
            <p className="text-slate-400 text-sm">No hay inquilinos registrados.</p>
          </div>
        ) : (
          <table className="w-full" aria-label="Lista de inquilinos">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Propiedad / Unidad</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Sync</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Portal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map(t => {
                const unit = t.units;
                const unitLabel = unit
                  ? `${unit.properties?.name ?? ''} — ${unit.label}`
                  : null;
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => window.location.href = `/dashboard/admin/tenants/${t.id}`}
                  >
                    <td className="px-5 py-4 font-medium text-slate-900 text-sm">
                      {t.full_name ?? '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {t.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unitLabel ?? <span className="text-slate-300">Sin asignar</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={tenantStatusVariant(t.tenant_status)}>
                        {tenantStatusLabel(t.tenant_status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <Badge variant={syncStatusVariant(t.sync_status)}>
                        {syncStatusLabel(t.sync_status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell">
                      {t.portal_access ?? <span className="text-slate-300">—</span>}
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
            Página {page} de {totalPages} — {total} resultados
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
