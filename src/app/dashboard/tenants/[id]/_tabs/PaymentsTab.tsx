import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
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

  const [supabase, t] = await Promise.all([
    createClient(),
    getTranslations('payments'),
  ]);

  const [paymentsRes, chargesRes, statementRes, receiptsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount, paid_at, method, status, reference')
      .eq('tenant_id', tenantId)
      .eq('org_id', ctx.orgId)
      .order('paid_at', { ascending: false })
      .limit(50),
    supabase
      .from('charges')
      .select('id, amount, description, period, due_date')
      .eq('tenant_id', tenantId)
      .eq('org_id', ctx.orgId)
      .order('due_date', { ascending: false })
      .limit(50),
    supabase
      .from('tenant_statement')
      .select('total_charges, total_approved_payments, balance, is_overdue')
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('payment_receipts')
      .select('id, source, status, extracted_amount, confidence, created_at, raw_text, matched_charge_id, matched_payment_id, rejection_reason')
      .eq('tenant_id', tenantId)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const payments = paymentsRes.data ?? [];
  const charges = chargesRes.data ?? [];
  const statement = statementRes.data ?? null;
  const receipts = receiptsRes.data ?? [];

  return (
    <div className="p-4 space-y-6">
      {/* Account Statement */}
      {statement && (
        <Card>
          <CardHeader><CardTitle>Account Statement</CardTitle></CardHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Total charged</dt>
              <dd>${statement.total_charges.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total paid</dt>
              <dd className="text-green-600">${statement.total_approved_payments.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between border-t pt-2">
              <dt className="font-semibold">Balance</dt>
              <dd className={`font-bold ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {statement.balance < 0 ? '-' : ''}${Math.abs(statement.balance).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Payments */}
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-400">No payments</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">${Number(p.amount).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{p.paid_at} · {p.method}</p>
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
        <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-400">No charges</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {charges.map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{c.description}</p>
                  <p className="text-xs text-slate-500">Period: {c.period} · Due: {c.due_date}</p>
                </div>
                <span className="font-medium">${Number(c.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Payment Receipts */}
      {receipts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('receipts.title')}</CardTitle></CardHeader>
          <div className="divide-y divide-slate-100">
            {receipts.map((r) => (
              <div key={r.id} className="py-3 text-sm">
                {/* Receipt summary row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {r.extracted_amount ? `$${Number(r.extracted_amount).toLocaleString()}` : 'Amount unknown'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t('receipts.source')}: {r.source} · {new Date(r.created_at).toLocaleDateString()}
                    </p>
                    {r.confidence && (
                      <p className="text-xs text-slate-400">
                        {t('receipts.confidence')}: {(r.confidence * 100).toFixed(0)}%
                      </p>
                    )}
                  </div>
                  <Badge variant={r.status === 'auto_approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'pending'}>
                    {r.status.replace('_', ' ')}
                  </Badge>
                </div>

                {/* OCR detail disclosure — zero JS, SSR-safe */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-800 select-none w-fit">
                    {t('receipts.ocr.viewDetail')}
                  </summary>
                  <dl className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-3 text-xs">
                    {/* raw_text */}
                    <div>
                      <dt className="font-medium text-slate-600">{t('receipts.ocr.rawText')}</dt>
                      <dd className="mt-0.5 text-slate-800 whitespace-pre-wrap break-words">
                        {r.raw_text
                          ? (r.raw_text.length > 300 ? `${r.raw_text.slice(0, 300)}…` : r.raw_text)
                          : <span className="text-slate-400 italic">{t('receipts.ocr.rawTextPending')}</span>
                        }
                      </dd>
                    </div>
                    {/* matched_charge_id */}
                    <div>
                      <dt className="font-medium text-slate-600">{t('receipts.ocr.matchedCharge')}</dt>
                      <dd className="mt-0.5 font-mono text-slate-700 break-all">
                        {r.matched_charge_id ?? <span className="text-slate-400 not-italic font-sans">{t('receipts.ocr.notMatched')}</span>}
                      </dd>
                    </div>
                    {/* matched_payment_id */}
                    <div>
                      <dt className="font-medium text-slate-600">{t('receipts.ocr.matchedPayment')}</dt>
                      <dd className="mt-0.5 font-mono text-slate-700 break-all">
                        {r.matched_payment_id ?? <span className="text-slate-400 not-italic font-sans">{t('receipts.ocr.notMatched')}</span>}
                      </dd>
                    </div>
                    {/* rejection_reason — only rendered when present */}
                    {r.rejection_reason && (
                      <div>
                        <dt className="font-medium text-red-600">{t('receipts.ocr.rejectionReason')}</dt>
                        <dd className="mt-0.5 text-red-700">{r.rejection_reason}</dd>
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
