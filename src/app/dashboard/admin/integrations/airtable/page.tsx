'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

interface SyncLog {
  id: string;
  table_name: string;
  status: string;
  records_upserted: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface EnvVar {
  name: string;
  configured: boolean;
}

interface StatusData {
  base_id: string | null;
  base_name: string | null;
  connectivity: {
    connected: boolean;
    latency_ms: number | null;
    error?: string;
  };
  tenant_sync_stats: Record<string, number>;
  recent_sync_logs: SyncLog[];
  env_vars: EnvVar[];
  checked_at: string;
}

function syncLogStatusVariant(s: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (s) {
    case 'success': return 'success';
    case 'partial': return 'warning';
    case 'error':   return 'danger';
    default:        return 'default';
  }
}

export default function AirtableSyncPage() {
  const [status, setStatus]   = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/admin/integrations/airtable/status');
      const json = await res.json() as StatusData;
      setStatus(json);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res  = await fetch('/api/admin/integrations/airtable/sync', { method: 'POST' });
      const json = await res.json() as { triggered?: boolean; results?: Array<{ entity: string; count: number; status: string }> };
      if (res.ok && json.triggered) {
        const total = (json.results ?? []).reduce((acc, r) => acc + r.count, 0);
        setSyncResult(`Sincronizacion completada. ${total} registros procesados.`);
      } else {
        setSyncResult('Error al iniciar la sincronizacion.');
      }
      await fetchStatus();
    } catch {
      setSyncResult('Error de red. Intenta de nuevo.');
    } finally {
      setSyncing(false);
    }
  }

  const syncStats = status?.tenant_sync_stats ?? {};
  const totalTenants = Object.values(syncStats).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Integracion Airtable</h1>
          <p className="text-sm text-slate-500 mt-1">Estado de la sincronizacion con la base de Airtable</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={syncing}
          onClick={handleSync}
        >
          {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
        </Button>
      </div>

      {syncResult && (
        <div role="status" className="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg px-4 py-3">
          {syncResult}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !status ? (
        <p className="text-sm text-slate-400">No se pudo cargar el estado de integracion.</p>
      ) : (
        <>
          {/* Section 1: Estado de conexion */}
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <h2 className="text-base font-semibold text-slate-800">Estado de conexion</h2>
            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full ${status.connectivity.connected ? 'bg-green-500' : 'bg-red-500'}`}
                aria-label={status.connectivity.connected ? 'Conectado' : 'Sin conexion'}
              />
              <span className="text-sm font-medium text-slate-700">
                {status.connectivity.connected ? 'Conectado' : 'Sin conexion'}
              </span>
              {status.connectivity.latency_ms !== null && (
                <span className="text-xs text-slate-400">{status.connectivity.latency_ms} ms</span>
              )}
            </div>
            {status.connectivity.error && (
              <p className="text-xs text-red-500">{status.connectivity.error}</p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Base</dt>
              <dd className="text-slate-700 font-medium">{status.base_name ?? '—'}</dd>
              <dt className="text-slate-500">Base ID</dt>
              <dd className="text-slate-700 font-mono text-xs">{status.base_id ?? '—'}</dd>
              <dt className="text-slate-500">Verificado</dt>
              <dd className="text-slate-700 text-xs">
                {new Date(status.checked_at).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
              </dd>
            </dl>
          </section>

          {/* Section 2: Estadisticas de inquilinos */}
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <h2 className="text-base font-semibold text-slate-800">Estadisticas de inquilinos</h2>
            <p className="text-xs text-slate-500">{totalTenants} inquilinos en total</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { key: 'synced',       label: 'Sincronizados', variant: 'success' as const },
                { key: 'pending',      label: 'Pendientes',    variant: 'warning' as const },
                { key: 'failed',       label: 'Con error',     variant: 'danger'  as const },
                { key: 'needs_review', label: 'Por revisar',   variant: 'info'    as const },
              ].map(({ key, label, variant }) => (
                <div key={key} className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-2xl font-bold text-slate-800">{syncStats[key] ?? 0}</p>
                  <Badge variant={variant} className="mt-1">{label}</Badge>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: Ultimas sincronizaciones */}
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <h2 className="text-base font-semibold text-slate-800">Ultimas sincronizaciones</h2>
            {status.recent_sync_logs.length === 0 ? (
              <p className="text-sm text-slate-400">Sin registros de sincronizacion.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 text-xs text-slate-500 font-semibold">Tabla</th>
                    <th className="text-left py-2 text-xs text-slate-500 font-semibold">Estado</th>
                    <th className="text-right py-2 text-xs text-slate-500 font-semibold">Registros</th>
                    <th className="text-right py-2 text-xs text-slate-500 font-semibold hidden sm:table-cell">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {status.recent_sync_logs.map(log => (
                    <tr key={log.id}>
                      <td className="py-2 font-mono text-xs text-slate-600">{log.table_name}</td>
                      <td className="py-2">
                        <Badge variant={syncLogStatusVariant(log.status)}>{log.status}</Badge>
                      </td>
                      <td className="py-2 text-right text-slate-700">{log.records_upserted}</td>
                      <td className="py-2 text-right text-slate-400 text-xs hidden sm:table-cell">
                        {new Date(log.started_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Section 4: Variables de entorno */}
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <h2 className="text-base font-semibold text-slate-800">Variables de entorno</h2>
            <p className="text-xs text-slate-500">Solo se muestran los nombres, nunca los valores.</p>
            <ul className="space-y-1">
              {status.env_vars.map(v => (
                <li key={v.name} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${v.configured ? 'bg-green-500' : 'bg-slate-300'}`} />
                  <span className={`font-mono text-xs ${v.configured ? 'text-slate-700' : 'text-slate-400'}`}>
                    {v.name}
                  </span>
                  {!v.configured && <span className="text-xs text-slate-400">(no configurado)</span>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
