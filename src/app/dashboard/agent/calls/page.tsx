import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentCalls } from '@/lib/db/schema';
import { and, count, desc, eq } from 'drizzle-orm';
import { Badge } from '@/components/ui/Badge';
import { maskPhone } from '../_components/format';

export const metadata: Metadata = { title: 'Llamadas del agente' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const PURPOSE_VALUES = ['inbound', 'speed_to_lead', 'visit_confirmation', 'reactivation'] as const;
const STATUS_VALUES = ['queued', 'dialing', 'in_progress', 'ended', 'failed', 'skipped', 'blocked'] as const;

const STATUS_BADGE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  queued: 'default',
  dialing: 'info',
  in_progress: 'info',
  ended: 'success',
  failed: 'danger',
  skipped: 'default',
  blocked: 'danger',
};

interface CallsSearchParams {
  page?: string;
  purpose?: string;
  status?: string;
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export default async function AgentCallsPage({
  searchParams,
}: {
  searchParams: Promise<CallsSearchParams>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const params = await searchParams;
  const t = await getTranslations('agentCalls');

  const page = Math.max(1, Number(params.page) || 1);
  const purposeFilter = PURPOSE_VALUES.includes(params.purpose as (typeof PURPOSE_VALUES)[number]) ? params.purpose : undefined;
  const statusFilter = STATUS_VALUES.includes(params.status as (typeof STATUS_VALUES)[number]) ? params.status : undefined;

  const filters = [eq(agentCalls.orgId, ctx.orgId)];
  if (purposeFilter) filters.push(eq(agentCalls.purpose, purposeFilter));
  if (statusFilter) filters.push(eq(agentCalls.status, statusFilter));
  const where = and(...filters);

  const [{ value: total }] = await db.select({ value: count() }).from(agentCalls).where(where);

  const rows = await db
    .select({
      id: agentCalls.id,
      direction: agentCalls.direction,
      purpose: agentCalls.purpose,
      status: agentCalls.status,
      outcome: agentCalls.outcome,
      customerPhone: agentCalls.customerPhone,
      durationSeconds: agentCalls.durationSeconds,
      costUsd: agentCalls.costUsd,
      createdAt: agentCalls.createdAt,
    })
    .from(agentCalls)
    .where(where)
    .orderBy(desc(agentCalls.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const sp = new URLSearchParams();
    sp.set('page', String(p));
    if (purposeFilter) sp.set('purpose', purposeFilter);
    if (statusFilter) sp.set('status', statusFilter);
    return `?${sp.toString()}`;
  };

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <Link href="/dashboard/agent" className="text-sm text-brand-600 hover:underline">← Métricas</Link>
      </div>

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="calls-purpose" className="text-xs font-medium text-slate-500">{t('purpose')}</label>
          <select id="calls-purpose" name="purpose" defaultValue={purposeFilter ?? ''} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
            <option value="">Todos</option>
            {PURPOSE_VALUES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="calls-status" className="text-xs font-medium text-slate-500">{t('status')}</label>
          <select id="calls-status" name="status" defaultValue={statusFilter ?? ''} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
            <option value="">Todos</option>
            {STATUS_VALUES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-indigo-600 text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-indigo-700 transition-colors">
          Filtrar
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('direction')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('purpose')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('status')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('outcome')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">Teléfono</th>
                <th className="text-right py-2 px-4 font-medium text-slate-600">{t('duration')}</th>
                <th className="text-right py-2 px-4 font-medium text-slate-600">{t('cost')}</th>
                <th className="text-right py-2 px-4 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 px-4 text-slate-700">{r.direction}</td>
                  <td className="py-2 px-4 text-slate-700">{humanize(r.purpose)}</td>
                  <td className="py-2 px-4"><Badge variant={STATUS_BADGE[r.status] ?? 'default'}>{humanize(r.status)}</Badge></td>
                  <td className="py-2 px-4 text-slate-700">{r.outcome ? humanize(r.outcome) : '—'}</td>
                  <td className="py-2 px-4 text-slate-500">{maskPhone(r.customerPhone)}</td>
                  <td className="py-2 px-4 text-right text-slate-700">{r.durationSeconds ?? '—'}</td>
                  <td className="py-2 px-4 text-right text-slate-700">{r.costUsd ? `$${Number(r.costUsd).toFixed(4)}` : '—'}</td>
                  <td className="py-2 px-4 text-right">
                    <Link href={`/dashboard/agent/calls/${r.id}`} className="text-brand-600 hover:underline">{t('transcript')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">{page} / {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={qs(page - 1)} className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50">‹</Link>}
            {page < totalPages && <Link href={qs(page + 1)} className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50">›</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
