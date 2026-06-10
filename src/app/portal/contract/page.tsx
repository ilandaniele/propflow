import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'My Contract' };

export default async function PortalContractPage() {
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

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*, units(label, properties(name))')
    .eq('tenant_id', tenantRecord.id)
    .eq('org_id', ctx.orgId)
    .order('start_date', { ascending: false });

  const list = contracts ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">My Contracts</h1>
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No contracts" description="No contracts have been created for your account yet." />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((contract) => {
            const unit = contract.units as { label: string; properties: { name: string } | null } | null;
            return (
              <Card key={contract.id}>
                <CardHeader>
                  <CardTitle>{unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : 'Contract'}</CardTitle>
                  <StatusPill status={contract.status} />
                </CardHeader>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500 mb-0.5">Monthly Rent</dt>
                    <dd className="font-semibold text-slate-900">${contract.monthly_rent.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 mb-0.5">Deposit</dt>
                    <dd className="font-semibold text-slate-900">
                      {contract.deposit ? `$${contract.deposit.toLocaleString()}` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 mb-0.5">Start Date</dt>
                    <dd className="text-slate-900">{contract.start_date}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 mb-0.5">End Date</dt>
                    <dd className="text-slate-900">{contract.end_date ?? '—'}</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
