import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { contracts, tenants, units, properties } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { CreateContractForm } from './CreateContractForm';

export const metadata: Metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [contractRows, tenantRows, unitRows, propertyRows] = await Promise.all([
    db.select({
      id: contracts.id,
      tenantId: contracts.tenantId,
      unitId: contracts.unitId,
      monthlyRent: contracts.monthlyRent,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
      createdAt: contracts.createdAt,
    })
      .from(contracts)
      .where(eq(contracts.orgId, ctx.orgId))
      .orderBy(desc(contracts.createdAt)),
    db.select({ id: tenants.id, fullName: tenants.fullName })
      .from(tenants)
      .where(eq(tenants.orgId, ctx.orgId)),
    db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.orgId, ctx.orgId)),
    db.select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(eq(properties.orgId, ctx.orgId)),
  ]);

  // Build lookup maps
  const tenantMap = new Map(tenantRows.map((t) => [t.id, t.fullName]));
  const propertyMap = new Map(propertyRows.map((p) => [p.id, p.name]));
  const unitMap = new Map(unitRows.map((u) => [u.id, { label: u.label, propertyName: propertyMap.get(u.propertyId) ?? null }]));

  // Shape for CreateContractForm prop compatibility
  const unitsForForm = unitRows.map((u) => ({
    id: u.id,
    label: u.label,
    property_id: u.propertyId,
    properties: { name: propertyMap.get(u.propertyId) ?? '' },
  }));
  const tenantsForForm = tenantRows.map((t) => ({ id: t.id, full_name: t.fullName }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contracts</h1>
          <p className="text-sm text-slate-500 mt-1">{contractRows.length} total</p>
        </div>
        <CreateContractForm tenants={tenantsForForm} units={unitsForForm as unknown as Array<{ id: string; label: string; property_id: string; properties: { name: string } | null }>} />
      </div>

      {contractRows.length === 0 ? (
        <Card>
          <EmptyState
            title="No contracts yet"
            description="Create a contract to link a tenant to a unit with rent terms."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Contracts list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Unit</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Term</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contractRows.map((contract) => {
                const tenantName = tenantMap.get(contract.tenantId) ?? '—';
                const unitInfo = unitMap.get(contract.unitId);
                return (
                  <tr key={contract.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenantName}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {unitInfo ? `${unitInfo.propertyName ?? ''} — ${unitInfo.label}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">${Number(contract.monthlyRent).toLocaleString()}/mo</td>
                    <td className="px-5 py-4 text-xs text-slate-500 hidden md:table-cell">
                      {contract.startDate} → {contract.endDate ?? '—'}
                    </td>
                    <td className="px-5 py-4"><StatusPill status={contract.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
