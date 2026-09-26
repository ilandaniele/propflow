import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentCalls } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { maskPhone } from '../../_components/format';

export const metadata: Metadata = { title: 'Llamada del agente' };
export const dynamic = 'force-dynamic';

export default async function AgentCallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const { callId } = await params;
  const t = await getTranslations('agentCalls');

  // IDOR guard: the call must belong to this org.
  const rows = await db
    .select()
    .from(agentCalls)
    .where(and(eq(agentCalls.id, callId), eq(agentCalls.orgId, ctx.orgId)))
    .limit(1);
  const call = rows[0];
  if (!call) notFound();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/agent/calls" className="text-sm text-brand-600 hover:underline">← {t('title')}</Link>
        <Badge variant={call.status === 'ended' ? 'success' : call.status === 'failed' || call.status === 'blocked' ? 'danger' : 'default'}>
          {call.status}
        </Badge>
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{t('direction')}</dt>
          <dd className="text-slate-900">{call.direction}</dd>
          <dt className="text-slate-500">{t('purpose')}</dt>
          <dd className="text-slate-900">{call.purpose}</dd>
          <dt className="text-slate-500">{t('outcome')}</dt>
          <dd className="text-slate-900">{call.outcome ?? '—'}</dd>
          <dt className="text-slate-500">{t('duration')}</dt>
          <dd className="text-slate-900">{call.durationSeconds != null ? `${call.durationSeconds}s` : '—'}</dd>
          <dt className="text-slate-500">{t('cost')}</dt>
          <dd className="text-slate-900">{call.costUsd ? `$${Number(call.costUsd).toFixed(4)}` : '—'}</dd>
          <dt className="text-slate-500">Teléfono</dt>
          <dd className="text-slate-900">{maskPhone(call.customerPhone)}</dd>
          <dt className="text-slate-500">{t('recording')}</dt>
          <dd className="text-slate-900">
            {call.recordingUrl ? (
              <a href={`/api/agent/voice/recording/${call.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                {t('recording')}
              </a>
            ) : '—'}
          </dd>
        </dl>
      </Card>

      <Card padding="md">
        <CardHeader><CardTitle>{t('summary')}</CardTitle></CardHeader>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{call.summary ?? '—'}</p>
      </Card>

      <Card padding="md">
        <CardHeader><CardTitle>{t('transcript')}</CardTitle></CardHeader>
        <p className="text-sm text-slate-700 whitespace-pre-wrap max-h-96 overflow-y-auto">{call.transcript ?? '—'}</p>
      </Card>
    </div>
  );
}
