import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { contracts } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import {
  getPortalPreviewVisitors,
  getPortalPreviewRecentPayments,
  getPortalPreviewRecentIncidents,
} from '@/lib/portal-preview/queries';

interface TenantSummary {
  id: string;
  full_name: string;
  email?: string | null;
  profile_id?: string | null;
  unit_id?: string | null;
  property_id?: string | null;
  org_id: string;
  units?: { label: string; properties?: { name: string } | null } | null;
}

interface Props {
  tenant: TenantSummary;
}

/**
 * Async Server Component — read-only summary card for the portal home preview.
 * Shows tenant name, unit, property, monthly rent, balance, recent payments,
 * recent incidents, and visitor count (last 30 days).
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function PortalHomeSection({ tenant }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');

  const [activeContractRows, statementResult, recentPayments, recentIncidents, allVisitors] =
    await Promise.all([
      db
        .select({ monthlyRent: contracts.monthlyRent, status: contracts.status, startDate: contracts.startDate, endDate: contracts.endDate })
        .from(contracts)
        .where(and(eq(contracts.tenantId, tenant.id), eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active')))
        .orderBy(desc(contracts.startDate))
        .limit(1),
      // tenant_statement is a PG VIEW — use raw SQL
      db.execute(sql`SELECT total_charges, total_approved_payments, balance, is_overdue FROM tenant_statement WHERE tenant_id = ${tenant.id} LIMIT 1`),
      getPortalPreviewRecentPayments(tenant.id, ctx.orgId),
      getPortalPreviewRecentIncidents(tenant.id, ctx.orgId),
      getPortalPreviewVisitors(tenant.id, ctx.orgId),
    ]);

  const contract = activeContractRows[0] ?? null;
  const statementRes = ((statementResult as unknown as Array<{
    total_charges: string;
    total_approved_payments: string;
    balance: string;
    is_overdue: boolean;
  }>)?.[0] ?? null);

  // Visitor count for last 30 days — derived in-memory from already-fetched rows
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
    .toISOString()
    .split('T')[0];
  const recentVisitorCount = allVisitors.filter(
    (v) => v.visit_date >= thirtyDaysAgo
  ).length;

  const unit = tenant.units;
  const propertyName = unit?.properties?.name ?? null;

  return (
    <Card data-testid="portal-preview-home">
      <CardHeader>
        <CardTitle>{t('portalPreview.sections.home')}</CardTitle>
      </CardHeader>

      {/* Tenant summary */}
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">{t('portalPreview.home.tenantName')}</dt>
          <dd className="font-medium text-slate-900">{tenant.full_name}</dd>
        </div>
        {tenant.email && (
          <div className="flex justify-between">
            <dt className="text-slate-500">Email</dt>
            <dd className="text-slate-700">{tenant.email}</dd>
          </div>
        )}
        {unit && (
          <div className="flex justify-between">
            <dt className="text-slate-500">{t('portalPreview.home.unit')}</dt>
            <dd className="text-slate-700">{unit.label}</dd>
          </div>
        )}
        {propertyName && (
          <div className="flex justify-between">
            <dt className="text-slate-500">{t('portalPreview.home.property')}</dt>
            <dd className="text-slate-700">{propertyName}</dd>
          </div>
        )}
        {contract && (
          <div className="flex justify-between">
            <dt className="text-slate-500">{t('portalPreview.home.monthlyRent')}</dt>
            <dd className="font-medium text-slate-900">
              ${Number(contract.monthlyRent).toLocaleString()}/mo
            </dd>
          </div>
        )}

        {/* Balance from tenant_statement (view) */}
        {statementRes ? (
          <div className="flex justify-between border-t pt-2 mt-2">
            <dt className="font-semibold text-slate-700">
              {t('portalPreview.home.balance')}
              {statementRes.is_overdue && (
                <span className="ml-2 text-xs font-normal text-red-600">
                  {t('portalPreview.home.overdue')}
                </span>
              )}
            </dt>
            <dd
              data-testid="portal-home-balance"
              className={`font-bold ${
                Number(statementRes.balance) < 0 ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {Number(statementRes.balance) < 0 ? '-' : ''}
              ${Math.abs(Number(statementRes.balance)).toLocaleString()}
            </dd>
          </div>
        ) : null}

        <div className="flex justify-between border-t pt-2 mt-2">
          <dt className="text-slate-500">{t('portalPreview.home.visitorCount')}</dt>
          <dd className="font-medium text-slate-900">{recentVisitorCount}</dd>
        </div>
      </dl>

      {/* Recent Payments mini-list */}
      <div className="mt-4 border-t pt-4" data-testid="portal-home-recent-payments">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t('portalPreview.home.recentPayments')}
        </h3>
        {recentPayments.length === 0 ? (
          <p className="text-xs text-slate-400">{t('portalPreview.home.noRecentPayments')}</p>
        ) : (
          <ul className="space-y-1.5">
            {recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">
                  ${Number(p.amount).toLocaleString()}
                  {p.paid_at && (
                    <span className="ml-1 text-slate-400">
                      · {new Date(p.paid_at).toLocaleDateString()}
                    </span>
                  )}
                </span>
                <StatusPill status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent Incidents mini-list */}
      <div className="mt-4 border-t pt-4" data-testid="portal-home-recent-incidents">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t('portalPreview.home.recentIncidents')}
        </h3>
        {recentIncidents.length === 0 ? (
          <p className="text-xs text-slate-400">{t('portalPreview.home.noRecentIncidents')}</p>
        ) : (
          <ul className="space-y-1.5">
            {recentIncidents.map((i) => (
              <li key={i.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700 truncate max-w-[60%]">{i.title}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-slate-400">
                    {new Date(i.created_at).toLocaleDateString()}
                  </span>
                  <StatusPill status={i.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
