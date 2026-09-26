import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { getAgentMetrics, resolveRange, safeTimezone, type MetricsChannel, type ChannelMetrics } from '@/lib/agent/metrics';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { DailyBars } from './_components/DailyBars';
import { MetricTile } from './_components/MetricTile';
import { formatPercent, formatSeconds, formatUsd } from './_components/format';

export const metadata: Metadata = { title: 'Métricas del agente' };
export const dynamic = 'force-dynamic';

interface MetricsSearchParams {
  range?: string;
  from?: string;
  to?: string;
}

const CHANNEL_LABEL: Record<MetricsChannel, string> = {
  all: 'Todos',
  whatsapp: 'WhatsApp',
  web: 'Web',
  voice: 'Voz',
};

const CHANNEL_ROWS: MetricsChannel[] = ['all', 'whatsapp', 'web', 'voice'];

export default async function AgentMetricsPage({
  searchParams,
}: {
  searchParams: Promise<MetricsSearchParams>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const params = await searchParams;
  const t = await getTranslations('agentMetrics');
  // Deliberately the only getTranslations() call in this file — tests/unit/i18n's
  // coverage check cross-validates every t() key against every namespace used
  // anywhere in the file, so a second namespace here would false-positive on
  // keys that only exist in one of them (see src/app/dashboard/leads/page.tsx
  // for the same note). The nav links and range-form labels below are plain
  // Spanish strings for that reason, not new i18n keys.

  const config = await getOrCreateAgentConfig(ctx.orgId);
  const range = resolveRange(params, safeTimezone(config.timezone));
  const metrics = await getAgentMetrics(ctx.orgId, range);

  const all = metrics.byChannel.all;
  const rangeParam = params.range ?? '30d';
  const fromDateInput = params.from ?? '';
  const toDateInput = params.to ?? '';

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/dashboard/agent/inbox" className="text-brand-600 hover:underline">Bandeja</Link>
          <Link href="/dashboard/agent/settings" className="text-brand-600 hover:underline">Configuración</Link>
          <Link href="/dashboard/agent/calls" className="text-brand-600 hover:underline">Llamadas</Link>
        </div>
      </div>

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-metrics-range" className="text-xs font-medium text-slate-500">{t('range')}</label>
          <select id="agent-metrics-range" name="range" defaultValue={rangeParam} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
            <option value="7d">7 días</option>
            <option value="30d">30 días</option>
            <option value="90d">90 días</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-metrics-from" className="text-xs font-medium text-slate-500">Desde</label>
          <input id="agent-metrics-from" name="from" type="date" defaultValue={fromDateInput} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-metrics-to" className="text-xs font-medium text-slate-500">Hasta</label>
          <input id="agent-metrics-to" name="to" type="date" defaultValue={toDateInput} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <button type="submit" className="bg-indigo-600 text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-indigo-700 transition-colors">
          Aplicar
        </button>
      </form>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricTile label={t('conversations')} value={String(all.conversations)} />
        <MetricTile label={t('leads')} value={String(all.leads)} />
        <MetricTile label={t('qualified')} value={String(all.qualifiedLeads)} />
        <MetricTile label={t('visitsBooked')} value={String(all.visitsBooked)} />
        <MetricTile label={t('conversion')} value={formatPercent(all.leadToVisitRate)} />
        <MetricTile label={t('visitsCompleted')} value={String(all.visitsCompleted)} />
        <MetricTile label={t('noShow')} value={String(all.visitsNoShow)} warn={all.visitsNoShow > 0} />
        <MetricTile label={t('handoffRate')} value={formatPercent(all.handoffRate)} warn={(all.handoffRate ?? 0) > 0} />
        <MetricTile label={t('aiCost')} value={formatUsd(all.aiCostUsd)} />
        <MetricTile label={t('voiceMinutes')} value={String(all.voiceMinutes)} />
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>{t('conversations')}</CardTitle></CardHeader>
        <DailyBars data={metrics.daily.map((d) => ({ day: d.day, conversations: d.conversations }))} noData={t('noData')} />
      </Card>

      <Card padding="md">
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {all.conversations === 0 && all.leads === 0 && all.calls === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">{t('noData')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 font-medium text-slate-600"></th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('conversations')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('leads')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('qualified')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('visitsBooked')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('visitsCompleted')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('noShow')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('conversion')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('firstResponse')} (p50/p90)</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('handoffRate')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('aiCost')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('costPerConversation')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('costPerVisit')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('calls')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('voiceMinutes')}</th>
                </tr>
              </thead>
              <tbody>
                {CHANNEL_ROWS.map((channel) => {
                  const m: ChannelMetrics = metrics.byChannel[channel];
                  return (
                    <tr key={channel} className={`border-b border-slate-50 ${channel === 'all' ? 'font-semibold bg-slate-50/50' : ''}`}>
                      <td className="py-2 text-slate-700">{CHANNEL_LABEL[channel]}</td>
                      <td className="py-2 text-right">{m.conversations}</td>
                      <td className="py-2 text-right">{m.leads}</td>
                      <td className="py-2 text-right">{m.qualifiedLeads}</td>
                      <td className="py-2 text-right">{m.visitsBooked}</td>
                      <td className="py-2 text-right">{m.visitsCompleted}</td>
                      <td className="py-2 text-right">{m.visitsNoShow}</td>
                      <td className="py-2 text-right">{formatPercent(m.leadToVisitRate)}</td>
                      <td className="py-2 text-right">{formatSeconds(m.firstResponseP50Sec)} / {formatSeconds(m.firstResponseP90Sec)}</td>
                      <td className="py-2 text-right">{formatPercent(m.handoffRate)}</td>
                      <td className="py-2 text-right">{formatUsd(m.aiCostUsd)}</td>
                      <td className="py-2 text-right">{m.costPerConversation !== null ? formatUsd(m.costPerConversation) : '—'}</td>
                      <td className="py-2 text-right">{m.costPerVisit !== null ? formatUsd(m.costPerVisit) : '—'}</td>
                      <td className="py-2 text-right">{m.calls}</td>
                      <td className="py-2 text-right">{m.voiceMinutes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
