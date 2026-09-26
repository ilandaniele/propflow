import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { qaExports } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const metadata: Metadata = { title: 'QA del agente' };

const RECENT_EXPORTS_LIMIT = 12;

export default async function AgentQaPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('agentQa');

  const exports = await db
    .select({
      id: qaExports.id,
      weekStart: qaExports.weekStart,
      rowCount: qaExports.rowCount,
      handoffCount: qaExports.handoffCount,
      complaintCount: qaExports.complaintCount,
      takeoverCount: qaExports.takeoverCount,
      emailedAt: qaExports.emailedAt,
    })
    .from(qaExports)
    .where(eq(qaExports.orgId, ctx.orgId))
    .orderBy(desc(qaExports.weekStart))
    .limit(RECENT_EXPORTS_LIMIT);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>

      <form action="/api/agent/qa-export" method="get" className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="qa-from" className="text-xs font-medium text-slate-500">{t('rangeFrom')}</label>
          <input id="qa-from" name="from" type="date" required className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="qa-to" className="text-xs font-medium text-slate-500">{t('rangeTo')}</label>
          <input id="qa-to" name="to" type="date" required className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <button
          type="submit"
          className="bg-indigo-600 text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-indigo-700 transition-colors"
        >
          {t('generate')}
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {exports.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2">{t('week')}</th>
                <th className="px-4 py-2">{t('handoffs')}</th>
                <th className="px-4 py-2">{t('complaints')}</th>
                <th className="px-4 py-2">{t('takeovers')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exports.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{e.weekStart}</td>
                  <td className="px-4 py-2 text-slate-700">{e.handoffCount ?? 0}</td>
                  <td className="px-4 py-2 text-slate-700">{e.complaintCount ?? 0}</td>
                  <td className="px-4 py-2 text-slate-700">{e.takeoverCount ?? 0}</td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={`/api/agent/qa-export?id=${e.id}`}
                      className="text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {t('download')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
