import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { tenants, units, properties } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { computePastDueBalance } from '@/lib/finance/kpis';
import { CreateTenantForm } from './CreateTenantForm';
import { TenantsCsvButtons } from './TenantsCsvButtons';

export const metadata: Metadata = { title: 'Tenants' };

export default async function TenantsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [tenantRows, unitRows, propertyRows] = await Promise.all([
    db.select({
      id: tenants.id,
      fullName: tenants.fullName,
      email: tenants.email,
      unitId: tenants.unitId,
      profileId: tenants.profileId,
      createdAt: tenants.createdAt,
    })
      .from(tenants)
      .where(eq(tenants.orgId, ctx.orgId))
      .orderBy(desc(tenants.createdAt)),
    db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.orgId, ctx.orgId)),
    db.select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(eq(properties.orgId, ctx.orgId)),
  ]);

  type StmtRow = { is_overdue: boolean; total_charged: string | null; total_paid: string | null };
  const statements: StmtRow[] = Array.from(await db.execute<StmtRow>(
    sql`SELECT is_overdue, total_charged, total_paid FROM tenant_statement WHERE org_id = ${ctx.orgId}`
  ));

  // Build lookup maps
  const propertyMap = new Map(propertyRows.map((p) => [p.id, p.name]));
  const unitMap = new Map(
    unitRows.map((u) => ({ id: u.id, label: u.label, propertyName: propertyMap.get(u.propertyId) ?? null }))
      .map((u) => [u.id, u])
  );

  // Compute aggregate Past Due Balance from overdue statements
  const overdueAmounts: number[] = statements
    .filter((s) => s.is_overdue)
    .map((s) => Math.max(0, Number(s.total_charged ?? 0) - Number(s.total_paid ?? 0)));
  const pastDueKpi = computePastDueBalance(overdueAmounts);

  const linkedCount = tenantRows.filter((t) => t.profileId).length;
  const overdueCount = statements.filter((s) => s.is_overdue).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenants</h1>
          <p className="text-sm text-slate-500 mt-1">{tenantRows.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <TenantsCsvButtons />
          <CreateTenantForm />
        </div>
      </div>

      {/* Aggregate KPI header */}
      {tenantRows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <article
            data-testid="kpi-past-due-balance"
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Past Due Balance
            </p>
            <p
              className={`text-2xl font-bold mb-1 ${
                pastDueKpi.value > 0 ? 'text-red-600' : 'text-green-700'
              }`}
            >
              {pastDueKpi.formatted}
            </p>
            <p className="text-xs text-slate-400">Total outstanding overdue</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Overdue Tenants
            </p>
            <p
              className={`text-2xl font-bold mb-1 ${
                overdueCount > 0 ? 'text-red-600' : 'text-green-700'
              }`}
            >
              {overdueCount}
            </p>
            <p className="text-xs text-slate-400">of {tenantRows.length} tenants</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Portal Linked
            </p>
            <p className="text-2xl font-bold mb-1 text-brand-700">{linkedCount}</p>
            <p className="text-xs text-slate-400">of {tenantRows.length} tenants have portal access</p>
          </article>
        </div>
      )}

      {tenantRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
            }
            title="No tenants yet"
            description="Add your first tenant to start managing contracts and payments."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Tenants list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Unit</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Portal</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenantRows.map((tenant) => {
                const unitInfo = tenant.unitId ? unitMap.get(tenant.unitId) : null;
                return (
                  <ClickableRow key={tenant.id} href={`/dashboard/tenants/${tenant.id}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={tenant.fullName} size="sm" />
                        <span className="font-medium text-slate-900 text-sm">{tenant.fullName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {tenant.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unitInfo ? `${unitInfo.propertyName ?? ''} — ${unitInfo.label}` : <span className="text-slate-300">Unassigned</span>}
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <Badge variant={tenant.profileId ? 'success' : 'default'}>
                        {tenant.profileId ? 'Active' : 'No login'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/dashboard/tenants/${tenant.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </td>
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
