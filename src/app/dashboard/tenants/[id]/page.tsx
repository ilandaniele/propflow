import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';

export const metadata: Metadata = { title: 'Tenant Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*, units(label, properties(name))')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) notFound();

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*')
    .eq('tenant_id', id)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });

  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('tenant_id', id)
    .eq('org_id', ctx.orgId)
    .order('paid_at', { ascending: false })
    .limit(10);

  const { data: statement } = await supabase
    .from('tenant_statement')
    .select('*')
    .eq('tenant_id', id)
    .single();

  const unit = tenant.units as { label: string; properties: { name: string } | null } | null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Avatar name={tenant.full_name} size="lg" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tenant.full_name}</h1>
          <p className="text-sm text-slate-500">
            {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : 'No unit assigned'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Contact */}
        <Card>
          <CardHeader><CardTitle>Contact Information</CardTitle></CardHeader>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 text-xs font-medium mb-0.5">Email</dt>
              <dd className="text-slate-900">{tenant.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs font-medium mb-0.5">Phone</dt>
              <dd className="text-slate-900">{tenant.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs font-medium mb-0.5">Portal access</dt>
              <dd>
                <StatusPill status={tenant.profile_id ? 'active' : 'pending'} />
              </dd>
            </div>
          </dl>
        </Card>

        {/* Balance */}
        <Card>
          <CardHeader><CardTitle>Account Statement</CardTitle></CardHeader>
          {statement ? (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total charges</dt>
                <dd className="font-medium text-slate-900">${statement.total_charges.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Approved payments</dt>
                <dd className="font-medium text-green-600">${statement.total_approved_payments.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3">
                <dt className="font-semibold text-slate-900">Balance</dt>
                <dd className={`font-bold text-base ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {statement.balance < 0 ? '-' : '+'}${Math.abs(statement.balance).toLocaleString()}
                </dd>
              </div>
              {statement.is_overdue && (
                <p className="text-xs text-red-600 font-medium">Overdue — past due charges exist</p>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">No charges or payments yet</p>
          )}
        </Card>
      </div>

      {/* Contracts */}
      <Card>
        <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
        {(contracts ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No contracts</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {(contracts ?? []).map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">${c.monthly_rent.toLocaleString()}/mo</p>
                  <p className="text-xs text-slate-500">{c.start_date} → {c.end_date}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent payments */}
      <Card>
        <CardHeader><CardTitle>Recent Payments</CardTitle></CardHeader>
        {(payments ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No payments</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {(payments ?? []).map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">${p.amount.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{p.paid_at} · {p.method}</p>
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
