import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, contracts, units, properties } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'My Contract' };

export default async function PortalContractPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows.length) {
    return <Card><EmptyState title="No tenant record" description="Contact your property manager." /></Card>;
  }

  const tenantId = tenantRows[0].id;

  const contractRows = await db
    .select({
      id:           contracts.id,
      status:       contracts.status,
      monthlyRent:  contracts.monthlyRent,
      deposit:      contracts.deposit,
      startDate:    contracts.startDate,
      endDate:      contracts.endDate,
      unitLabel:    units.label,
      propertyName: properties.name,
    })
    .from(contracts)
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.orgId, ctx.orgId)))
    .orderBy(desc(contracts.startDate));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">My Contracts</h1>
      {contractRows.length === 0 ? (
        <Card>
          <EmptyState title="No contracts" description="No contracts have been created for your account yet." />
        </Card>
      ) : (
        <div className="space-y-4">
          {contractRows.map((contract) => (
            <Card key={contract.id}>
              <CardHeader>
                <CardTitle>
                  {contract.unitLabel
                    ? `${contract.propertyName ?? ''} — ${contract.unitLabel}`
                    : 'Contract'}
                </CardTitle>
                <StatusPill status={contract.status} />
              </CardHeader>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500 mb-0.5">Monthly Rent</dt>
                  <dd className="font-semibold text-slate-900">${Number(contract.monthlyRent).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 mb-0.5">Deposit</dt>
                  <dd className="font-semibold text-slate-900">
                    {contract.deposit ? `$${Number(contract.deposit).toLocaleString()}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 mb-0.5">Start Date</dt>
                  <dd className="text-slate-900">{contract.startDate}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 mb-0.5">End Date</dt>
                  <dd className="text-slate-900">{contract.endDate ?? '—'}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
