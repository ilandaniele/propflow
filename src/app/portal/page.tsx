import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  tenants,
  units,
  properties,
  contracts,
  incidents,
  payments,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
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
  const tenantRows = await db
    .select({
      id:           tenants.id,
      fullName:     tenants.fullName,
      unitId:       tenants.unitId,
      unitLabel:    units.label,
      propertyName: properties.name,
    })
    .from(tenants)
    .leftJoin(units, and(eq(units.id, tenants.unitId), eq(units.orgId, ctx.orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows.length) {
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

  const tenantRecord = tenantRows[0];

  const [contractRows, statementResult, incidentRows, paymentRows, unitImagesRes] = await Promise.all([
    db
      .select({
        id:          contracts.id,
        status:      contracts.status,
        monthlyRent: contracts.monthlyRent,
        startDate:   contracts.startDate,
        endDate:     contracts.endDate,
      })
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantRecord.id), eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active')))
      .limit(1),
    // tenant_statement is a PG VIEW — raw SQL
    db.execute(sql`SELECT balance, is_overdue FROM tenant_statement WHERE tenant_id = ${tenantRecord.id} LIMIT 1`),
    db
      .select({ id: incidents.id, title: incidents.title, status: incidents.status, createdAt: incidents.createdAt })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantRecord.id), eq(incidents.orgId, ctx.orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(3),
    db
      .select({ id: payments.id, amount: payments.amount, paidAt: payments.paidAt, method: payments.method, status: payments.status })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantRecord.id), eq(payments.orgId, ctx.orgId)))
      .orderBy(desc(payments.paidAt))
      .limit(3),
    getUnitImagesTenant(),
  ]);

  const contract = contractRows[0] ?? null;
  const stmtRows = (statementResult as unknown as Array<{ balance: string; is_overdue: boolean }>);
  const statement = stmtRows[0] ?? null;
  const unitImages = unitImagesRes.data ?? [];

  const firstName = ctx.profile.full_name?.split(' ')[0] ?? 'Tenant';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Welcome back, {firstName}</h1>
        {(tenantRecord.unitLabel || tenantRecord.propertyName) && (
          <p className="text-sm text-slate-500 mt-0.5">
            {tenantRecord.propertyName} — {tenantRecord.unitLabel}
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
        {paymentRows.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-slate-400">No payments recorded yet</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {paymentRows.map((p) => (
              <Card key={p.id} padding="sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">${Number(p.amount).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{p.paidAt ? String(p.paidAt).slice(0, 10) : '—'} · {p.method}</p>
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
