import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const styles: Record<string, string> = {
    dry_run:   'bg-blue-50 text-blue-700 border-blue-200',
    committed: 'bg-green-50 text-green-700 border-green-200',
    failed:    'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function ImportTypeLabel({ type, labels }: { type: string; labels: Record<string, string> }) {
  return <span>{labels[type] ?? type}</span>;
}

interface LogRow {
  id: string;
  import_type: string;
  original_filename: string;
  period: string;
  status: string;
  row_count: number;
  failed_count: number;
  committed_at: string | null;
  created_at: string;
  created_by: string;
}

export default async function ImportLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  const t = await getTranslations('importLogs');

  const typeLabels: Record<string, string> = {
    monthly_billed:    t('types.monthlyBilled'),
    monthly_collected: t('types.monthlyCollected'),
    monthly_summary:   t('types.monthlySummary'),
    room_performance:  t('types.roomPerformance'),
  };

  const statusLabels: Record<string, string> = {
    dry_run:   t('status.dryRun'),
    committed: t('status.committed'),
    failed:    t('status.failed'),
  };

  const params = await searchParams;
  const page   = Math.max(0, parseInt(params.page ?? '0', 10));
  const limit  = 20;
  const from   = page * limit;
  const to     = from + limit - 1;
  const statusFilter = params.status ?? '';

  const supabase = await createClient();
  let query = supabase
    .from('csv_imports')
    .select('id, import_type, original_filename, period, status, row_count, failed_count, committed_at, created_at, created_by', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, count, error } = await query;

  const rows: LogRow[] = data ?? [];
  const total   = count ?? 0;
  const hasPrev = page > 0;
  const hasNext = from + limit < total;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <form className="flex items-center gap-3" method="get">
        <label htmlFor="status-filter" className="text-sm text-slate-600">{t('filterLabel')}</label>
        <select
          id="status-filter"
          name="status"
          defaultValue={statusFilter}
          className="border border-slate-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
        >
          <option value="">{t('filterAll')}</option>
          <option value="dry_run">{t('status.dryRun')}</option>
          <option value="committed">{t('status.committed')}</option>
          <option value="failed">{t('status.failed')}</option>
        </select>
        <span className="text-sm text-slate-400 ml-auto">{t('totalCount', { count: total })}</span>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700" role="alert">
          {t('loadError')}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="import-logs-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colType')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colFile')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colPeriod')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colStatus')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">{t('colRows')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">{t('colErrors')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colDate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  {t('empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-slate-700">
                  <ImportTypeLabel type={row.import_type} labels={typeLabels} />
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={row.original_filename}>
                  {row.original_filename}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{row.period}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} labels={statusLabels} />
                </td>
                <td className="px-4 py-3 text-right text-slate-700 font-medium">{row.row_count ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  {(row.failed_count ?? 0) > 0 ? (
                    <span className="text-red-600 font-medium">{row.failed_count}</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                  {new Date(row.created_at).toLocaleDateString(undefined, {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">
          {t('pagination', { page: page + 1, total: Math.max(1, Math.ceil(total / limit)) })}
        </span>
        <div className="flex gap-2">
          {hasPrev && (
            <a
              href={`?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
              className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t('prev')}
            </a>
          )}
          {hasNext && (
            <a
              href={`?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
              className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t('next')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
