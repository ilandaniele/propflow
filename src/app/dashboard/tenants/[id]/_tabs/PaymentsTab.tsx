import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments, charges, paymentReceipts, contracts } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, Badge } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches payments, charges, statement, and
 * payment_receipts for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function PaymentsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [paymentsRows, chargesRows, statementResult, receiptsRows, t] = await Promise.all([
    db
      .select({
        id:        payments.id,
        amount:    payments.amount,
        paidAt:    payments.paidAt,
        method:    payments.method,
        status:    payments.status,
        reference: payments.reference,
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.orgId, ctx.orgId)))
      .orderBy(desc(payments.paidAt))
      .limit(50),
    db
      .select({
        id:          charges.id,
        amount:      charges.amount,
        description: charges.description,
        period:      charges.period,
        dueDate:     charges.dueDate,
      })
      .from(charges)
      .where(and(eq(charges.tenantId, tenantId), eq(charges.orgId, ctx.orgId)))
      .orderBy(desc(charges.dueDate))
      .limit(50),
    // tenant_statement is a PG VIEW — must use raw SQL
    db.execute(sql`SELECT total_charges, total_approved_payments, balance, is_overdue FROM tenant_statement WHERE tenant_id = ${tenantId} LIMIT 1`),
    db
      .select({
        id:               paymentReceipts.id,
        source:           paymentReceipts.source,
        status:           paymentReceipts.status,
        extractedAmount:  paymentReceipts.extractedAmount,
        confidence:       paymentReceipts.confidence,
        createdAt:        paymentReceipts.createdAt,
        matchedChargeId:  paymentReceipts.matchedChargeId,
        matchedPaymentId: paymentReceipts.matchedPaymentId,
        rejectionReason:  paymentReceipts.rejectionReason,
      })
      .from(paymentReceipts)
      .where(and(eq(paymentReceipts.tenantId, tenantId), eq(paymentReceipts.orgId, ctx.orgId)))
      .orderBy(desc(paymentReceipts.createdAt))
      .limit(20),
    getTranslations('payments'),
  ]);

  const statement = ((statementResult as unknown as Array<{
    total_charges: string;
    total_approved_payments: string;
    balance: string;
    is_overdue: boolean;
  }>)?.[0] ?? null);

  return (
    <div className="p-4 space-y-6">
      {/* Account Statement */}
      {statement && (
        <Card>
          <CardHeader><CardTitle>{t('accountStatement')}</CardTitle></CardHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">{t('totalCharged')}</dt>
              <dd>S/ {Number(statement.total_charges).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{t('totalPaid')}</dt>
              <dd className="text-green-600">S/ {Number(statement.total_approved_payments).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</dd>
            </div>
            <div className="flex justify-between border-t pt-2">
              <dt className="font-semibold">{t('balance')}</dt>
              <dd className={`font-bold ${Number(statement.balance) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {Number(statement.balance) < 0 ? '-' : ''}S/ {Math.abs(Number(statement.balance)).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Payments */}
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {paymentsRows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('list.emptyTitle')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {paymentsRows.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">S/ {Number(p.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
                  <p className="text-xs text-slate-500">{p.paidAt ? String(p.paidAt) : '—'} · {p.method}</p>
                  {p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}
                </div>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Charges */}
      <Card>
        <CardHeader><CardTitle>{t('charges')}</CardTitle></CardHeader>
        {chargesRows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('list.emptyTitle')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {chargesRows.map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{c.description}</p>
                  <p className="text-xs text-slate-500">{t('period')}: {c.period ? String(c.period) : '—'} · {t('dueDate')}: {c.dueDate ? String(c.dueDate) : '—'}</p>
                </div>
                <span className="font-medium">S/ {Number(c.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Payment Receipts */}
      {receiptsRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('receipts.title')}</CardTitle></CardHeader>
          <div className="divide-y divide-slate-100">
            {receiptsRows.map((r) => (
              <div key={r.id} className="py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {r.extractedAmount ? `S/ ${Number(r.extractedAmount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : t('amount')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t('receipts.source')}: {r.source} · {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                    {r.confidence && (
                      <p className="text-xs text-slate-400">
                        {t('receipts.confidence')}: {(Number(r.confidence) * 100).toFixed(0)}%
                      </p>
                    )}
                  </div>
                  <Badge variant={r.status === 'auto_approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'pending'}>
                    {r.status.replace('_', ' ')}
                  </Badge>
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-brand-600 hover:text-brand-800 select-none w-fit">
                    {t('receipts.ocr.viewDetail')}
                  </summary>
                  <dl className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-3 text-xs">
                    <div>
                      <dt className="font-medium text-slate-600">{t('receipts.ocr.matchedCharge')}</dt>
                      <dd className="mt-0.5 font-mono text-slate-700 break-all">
                        {r.matchedChargeId ?? <span className="text-slate-400 not-italic font-sans">{t('receipts.ocr.notMatched')}</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-600">{t('receipts.ocr.matchedPayment')}</dt>
                      <dd className="mt-0.5 font-mono text-slate-700 break-all">
                        {r.matchedPaymentId ?? <span className="text-slate-400 not-italic font-sans">{t('receipts.ocr.notMatched')}</span>}
                      </dd>
                    </div>
                    {r.rejectionReason && (
                      <div>
                        <dt className="font-medium text-red-600">{t('receipts.ocr.rejectionReason')}</dt>
                        <dd className="mt-0.5 text-red-700">{r.rejectionReason}</dd>
                      </div>
                    )}
                  </dl>
                </details>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
