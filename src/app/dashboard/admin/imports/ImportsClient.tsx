'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface ImportLog {
  id: string;
  import_type: string;
  file_name: string | null;
  role: string | null;
  status: string;
  rows_received: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_failed: number;
  created_at: string;
  completed_at: string | null;
  imported_by_name: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  tenant:           'Inquilinos',
  payment:          'Pagos',
  room_performance: 'Rendimiento',
  financial:        'Financiero',
};

function typeLabel(t: string) { return TYPE_LABELS[t] ?? t; }

function statusVariant(s: string): 'warning' | 'success' | 'danger' | 'info' | 'default' {
  switch (s) {
    case 'pending':   return 'warning';
    case 'completed': return 'success';
    case 'failed':    return 'danger';
    case 'partial':   return 'info';
    default:          return 'default';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'pending':   return 'Pendiente';
    case 'completed': return 'Completado';
    case 'failed':    return 'Fallido';
    case 'partial':   return 'Parcial';
    default:          return s;
  }
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const LIMIT = 20;

export function ImportsClient() {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (filterType) q.set('import_type', filterType);
      if (filterStatus) q.set('status', filterStatus);
      const res = await fetch(`/api/admin/imports?${q}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterStatus]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); setExpandedDetail(null); return; }
    setExpandedId(id);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/imports/${id}`);
      if (res.ok) setExpandedDetail(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Historial de Importaciones</h1>
      </div>

      {/* Filters */}
      <Card padding="sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
            <select
              value={filterType}
              onChange={e => { setFilterType(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Todos</option>
              <option value="tenant">Inquilinos</option>
              <option value="payment">Pagos</option>
              <option value="room_performance">Rendimiento</option>
              <option value="financial">Financiero</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Estado</label>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="completed">Completado</option>
              <option value="failed">Fallido</option>
              <option value="partial">Parcial</option>
            </select>
          </div>
          {(filterType || filterStatus) && (
            <button
              onClick={() => { setFilterType(''); setFilterStatus(''); setPage(1); }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </Card>

      <Card padding="none">
        <CardHeader className="px-5 pt-5 pb-4">
          <CardTitle>Importaciones</CardTitle>
          {total > 0 && <span className="text-xs text-slate-400">{total} registros</span>}
        </CardHeader>

        {loading ? (
          <SkeletonTable rows={5} cols={8} />
        ) : logs.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="No hay registros de importación." description="Las importaciones aparecerán aquí una vez se realicen." />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Tipo</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Archivo</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Importado por</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Estado</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Recibidos</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Creados</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Actualizados</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Omitidos</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Fallidos</th>
                    <th className="px-4 py-3 text-center font-medium text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(log => (
                    <>
                      <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{fmtDate(log.created_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{typeLabel(log.import_type)}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs max-w-[150px] truncate">{log.file_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{log.imported_by_name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(log.status)}>{statusLabel(log.status)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{log.rows_received}</td>
                        <td className="px-4 py-3 text-right text-green-700">{log.rows_created}</td>
                        <td className="px-4 py-3 text-right text-blue-700">{log.rows_updated}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{log.rows_skipped}</td>
                        <td className="px-4 py-3 text-right text-red-700">{log.rows_failed}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="text-xs text-brand-600 hover:text-brand-700 underline"
                          >
                            {expandedId === log.id ? 'Cerrar' : 'Detalles'}
                          </button>
                        </td>
                      </tr>
                      {expandedId === log.id && (
                        <tr key={`${log.id}-detail`}>
                          <td colSpan={11} className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                            {loadingDetail ? (
                              <p className="text-xs text-slate-400 animate-pulse">Cargando detalles...</p>
                            ) : expandedDetail ? (
                              <div className="space-y-3 text-xs">
                                {Array.isArray((expandedDetail as Record<string, unknown>).error_details) &&
                                  ((expandedDetail as Record<string, unknown>).error_details as unknown[]).length > 0 && (
                                  <div>
                                    <p className="font-medium text-red-700 mb-1">Errores:</p>
                                    <ul className="space-y-0.5 text-red-700 max-h-32 overflow-y-auto">
                                      {((expandedDetail as Record<string, unknown>).error_details as Record<string, unknown>[]).map((e, i) => (
                                        <li key={i}>Fila {String(e.rowNumber)}: {String(e.message)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {Array.isArray((expandedDetail as Record<string, unknown>).validation_warnings) &&
                                  ((expandedDetail as Record<string, unknown>).validation_warnings as unknown[]).length > 0 && (
                                  <div>
                                    <p className="font-medium text-yellow-700 mb-1">Advertencias:</p>
                                    <ul className="space-y-0.5 text-yellow-700 max-h-32 overflow-y-auto">
                                      {((expandedDetail as Record<string, unknown>).validation_warnings as Record<string, unknown>[]).map((w, i) => (
                                        <li key={i}>Fila {String(w.rowNumber)}: {String(w.message)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {!Array.isArray((expandedDetail as Record<string, unknown>).error_details) && (
                                  <p className="text-slate-400">Sin detalles adicionales.</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400">No se pudieron cargar los detalles.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100">
                <span className="text-xs text-slate-400">Página {page} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <div className="flex gap-3">
        <Link href="/dashboard/admin/tenants" className="text-xs text-brand-600 hover:underline">← Volver a Inquilinos</Link>
      </div>
    </div>
  );
}
