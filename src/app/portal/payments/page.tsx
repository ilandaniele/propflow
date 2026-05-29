import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { RecordPaymentForm } from './RecordPaymentForm';

export const metadata: Metadata = { title: 'Payments' };

export default async function PortalPaymentsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: tenantRecord } = await supabase
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenantRecord) return (
    <Card><EmptyState title="No tenant record" description="Contact your property manager." /></Card>
  );

  const [paymentsRes, statementRes, contractRes, chargesRes] = await Promise.all([
    supabase.from('payments').select('*').eq('tenant_id', tenantRecord.id).eq('org_id', ctx.orgId).order('paid_at', { ascending: false }).limit(50),
    supabase.from('tenant_statement').select('*').eq('tenant_id', tenantRecord.id).single(),
    supabase.from('contracts').select('id, monthly_rent').eq('tenant_id', tenantRecord.id).eq('status', 'active').eq('org_id', ctx.orgId).single(),
    supabase.from('charges').select('*').eq('tenant_id', tenantRecord.id).eq('org_id', ctx.orgId).order('due_date', { ascending: false }),
  ]);

  const payments = paymentsRes.data ?? [];
  const statement = statementRes.data;
  const contract = contractRes.data;
  const charges = chargesRes.data ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Payments & Statement</h1>

      {/* Balance */}
      <Card>
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-xs text-slate-500 mb-1">Total Charges</dt>
            <dd className="font-bold text-slate-900">${(statement?.total_charges ?? 0).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 mb-1">Total Paid</dt>
            <dd className="font-bold text-green-600">${(statement?.total_approved_payments ?? 0).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 mb-1">Balance</dt>
            <dd className={`font-bold text-base ${(statement?.balance ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {(statement?.balance ?? 0) < 0 ? '-' : '+'}${Math.abs(statement?.balance ?? 0).toLocaleString()}
            </dd>
          </div>
        </dl>
        {statement?.is_overdue && (
          <p className="text-xs text-red-600 font-medium mt-3 text-center">Overdue</p>
        )}
      </Card>

      {/* Record payment */}
      {contract && <RecordPaymentForm contractId={contract.id} monthlyRent={contract.monthly_rent} />}

      {/* Charges */}
      <Card>
        <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-400">No charges</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {charges.map((charge) => (
              <div key={charge.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{charge.description}</p>
                  <p className="text-xs text-slate-400">
                    {charge.period && `Period: ${charge.period}`}
                    {charge.due_date && ` · Due: ${charge.due_date}`}
                  </p>
                </div>
                <span className="font-semibold text-slate-900 text-sm">${charge.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        {payments.length === 0 ? (
          <EmptyState title="No payments yet" description="Record your first payment using the form above." />
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">${p.amount.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{p.paid_at} · {p.method}
                    {p.reference && ` · Ref: ${p.reference}`}
                  </p>
                </div>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
