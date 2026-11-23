import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, depositMovements, tenants, units } from '@/lib/db/schema';
import { depositTotalsColumns, heldDeposit } from '@/lib/finance/deposit';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { DepositMovementForm } from './DepositMovementForm';

export const metadata: Metadata = { title: 'Deposit' };

export default async function DepositDetailPage({ params }: { params: Promise<{ contractId: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const { contractId } = await params;
  const t = await getTranslations('deposits');

  const [[contract], movements] = await Promise.all([
    db
      .select({
        id: contracts.id,
        agreed: contracts.deposit,
        tenantName: tenants.fullName,
        unitLabel: units.label,
        ...depositTotalsColumns,
      })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(depositMovements, and(eq(depositMovements.contractId, contracts.id), eq(depositMovements.orgId, ctx.orgId)))
      .where(and(eq(contracts.id, contractId), eq(contracts.orgId, ctx.orgId)))
      .groupBy(contracts.id),
    db
      .select({
        id: depositMovements.id,
        kind: depositMovements.kind,
        amount: depositMovements.amount,
        movedOn: depositMovements.movedOn,
        description: depositMovements.description,
      })
      .from(depositMovements)
      .where(and(eq(depositMovements.contractId, contractId), eq(depositMovements.orgId, ctx.orgId)))
      .orderBy(desc(depositMovements.movedOn), desc(depositMovements.createdAt))
      .limit(200),
  ]);

  if (!contract) notFound();
  const held = heldDeposit(contract);
  const kindLabel = { collected: t('kindCollected'), deduction: t('kindDeduction'), refund: t('kindRefund') } as Record<string, string>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/dashboard/deposits" className="text-sm text-brand-700 hover:underline">← {t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{contract.tenantName ?? '—'}</h1>
        <p className="text-sm text-slate-500">{contract.unitLabel ?? '—'}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          [t('colAgreed'), Number(contract.agreed ?? 0)],
          [t('colCollected'), Number(contract.collected)],
          [t('colDeducted'), Number(contract.deducted) + Number(contract.refunded)],
          [t('colHeld'), held],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-lg font-bold text-slate-900">{formatMoney(value as number)}</p>
          </div>
        ))}
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('form.title')}</h2>
        <DepositMovementForm contractId={contract.id} held={held} />
      </Card>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm" aria-label={t('historyTitle')}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3">{t('colDate')}</th>
              <th className="text-left px-4 py-3">{t('colKind')}</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">{t('colDescription')}</th>
              <th className="text-right px-4 py-3">{t('colAmount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">{t('historyEmpty')}</td></tr>
            ) : movements.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 text-slate-500">{m.movedOn}</td>
                <td className="px-4 py-3">{kindLabel[m.kind] ?? m.kind}</td>
                <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{m.description ?? '—'}</td>
                <td className={`px-4 py-3 text-right font-medium ${m.kind === 'collected' ? 'text-green-700' : 'text-slate-900'}`}>
                  {m.kind === 'collected' ? '+' : '−'}{formatMoney(Number(m.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
