import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { tenants, units, properties, contracts, incidents, payments } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { UnitImageGallery } from '@/components/images/UnitImageGallery';
import { getUnitImagesTenant } from '@/app/actions/unit-images';

export const metadata: Metadata = { title: 'My Portal' };

export default async function PortalOverviewPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'portal' });

  // Get tenant record for this user
  const tenantRow = await db.select({
    id: tenants.id,
    fullName: tenants.fullName,
    unitId: tenants.unitId,
  })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .then((r) => r[0] ?? null);

  if (!tenantRow) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-slate-900">Welcome</h1>
        <Card>
          <EmptyState
            title="Account not linked"
            description="Your login hasn't been linked to a tenant record yet. Contact your property manager."
          />
        </Card>
      </div>
    );
  }

  // Resolve unit + property info
  let unit: { label: string; properties: { name: string } | null } | null = null;
  if (tenantRow.unitId) {
    const unitRow = await db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, tenantRow.unitId))
      .then((r) => r[0] ?? null);
    if (unitRow) {
      const propertyRow = await db.select({ name: properties.name })
        .from(properties)
        .where(eq(properties.id, unitRow.propertyId))
        .then((r) => r[0] ?? null);
      unit = { label: unitRow.label, properties: propertyRow ? { name: propertyRow.name } : null };
    }
  }

  const [contractRows, , incidentRows, recentPaymentRows, unitImagesRes] = await Promise.all([
    db.select({
      id: contracts.id,
      monthlyRent: contracts.monthlyRent,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
    })
      .from(contracts)
      .where(and(
        eq(contracts.tenantId, tenantRow.id),
        eq(contracts.status, 'active'),
        eq(contracts.orgId, ctx.orgId),
      ))
      .limit(1),
    // placeholder — tenant_statement fetched separately below
    Promise.resolve(null),
    db.select({ id: incidents.id, title: incidents.title, status: incidents.status, createdAt: incidents.createdAt })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantRow.id), eq(incidents.orgId, ctx.orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(3),
    db.select({ id: payments.id, amount: payments.amount, paidAt: payments.paidAt, method: payments.method, status: payments.status })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantRow.id), eq(payments.orgId, ctx.orgId)))
      .orderBy(desc(payments.paidAt))
      .limit(3),
    getUnitImagesTenant(),
  ]);

  const contract = contractRows[0] ?? null;

  // tenant_statement is a DB VIEW — raw SQL
  type PortalStmtRow = { is_overdue: boolean; balance: string | null };
  const stmtRows: PortalStmtRow[] = Array.from(await db.execute<PortalStmtRow>(
    sql`SELECT is_overdue, balance FROM tenant_statement WHERE tenant_id = ${tenantRow.id} LIMIT 1`
  ));
  const statement = stmtRows[0] ?? null;
  const recentPayments = recentPaymentRows;
  const unitImages = unitImagesRes.data ?? [];

  // Storage signed URL for unit gallery still uses Supabase Storage (kept intentionally)
  // The UnitImageGallery component handles its own signed URLs via getUnitImagesTenant action

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Welcome back, {ctx.profile.fullName?.split(' ')[0] ?? 'Tenant'}</h1>
        {unit && (
          <p className="text-sm text-slate-500 mt-0.5">
            {unit.properties?.name} — {unit.label}
          </p>
        )}
      </div>

      {/* Balance card */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current Balance</p>
            {statement ? (
              <>
                <p className={`text-3xl font-bold ${Number(statement.balance) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {Number(statement.balance) < 0 ? '-' : '+'}${Math.abs(Number(statement.balance)).toLocaleString()}
                </p>
                {statement.is_overdue && (
                  <p className="text-xs text-red-600 font-medium mt-1">Overdue — please make a payment</p>
                )}
              </>
            ) : (
              <p className="text-3xl font-bold text-green-600">$0</p>
            )}
          </div>
          <Link href="/portal/payments" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View statement →
          </Link>
        </div>
      </Card>

      {/* Active contract */}
      {contract ? (
        <Card padding="sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Active Contract</p>
              <p className="font-semibold text-slate-900">${Number(contract.monthlyRent).toLocaleString()}/month</p>
              <p className="text-xs text-slate-500 mt-0.5">{contract.startDate} → {contract.endDate ?? '—'}</p>
            </div>
            <Link href="/portal/contract">
              <StatusPill status={contract.status} />
            </Link>
          </div>
        </Card>
      ) : (
        <Card padding="sm">
          <p className="text-sm text-slate-500">No active contract</p>
        </Card>
      )}

      {/* Unit image gallery — read-only; IDOR enforced by getUnitImagesTenant() */}
      {unitImages.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">{t('gallery.title')}</h2>
          <Card padding="sm">
            <UnitImageGallery
              images={unitImages}
              labels={{ cover: t('gallery.cover'), empty: t('gallery.empty') }}
            />
          </Card>
        </div>
      )}

      {/* Recent payments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent Payments</h2>
          <Link href="/portal/payments" className="text-xs text-brand-600 hover:text-brand-700">See all</Link>
        </div>
        {recentPayments.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-slate-400">No payments recorded yet</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((p) => (
              <Card key={p.id} padding="sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">${Number(p.amount).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{p.paidAt} · {p.method}</p>
                  </div>
                  <StatusPill status={p.status} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent incidents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">My Incidents</h2>
          <Link href="/portal/incidents" className="text-xs text-brand-600 hover:text-brand-700">See all</Link>
        </div>
        {incidentRows.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-slate-400">No incidents reported</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {incidentRows.map((i) => (
              <Link key={i.id} href={`/portal/incidents/${i.id}`}>
                <Card padding="sm" className="hover:border-brand-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900 text-sm truncate">{i.title}</p>
                    <StatusPill status={i.status} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
