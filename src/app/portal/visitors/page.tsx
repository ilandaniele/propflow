import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { AuthorizedVisitorsCard } from '@/components/visitors/AuthorizedVisitorsCard';
import { findTenantActiveUnit, listAuthorizedVisitors, listVisitorLogs } from '@/lib/visitors/queries';

export default async function PortalVisitorsPage() {
  const ctx = await requireTenant();
  const t = await getTranslations('visitorAccess');
  const tenantUnit = await findTenantActiveUnit(ctx.orgId, ctx.userId);

  if (!tenantUnit) {
    return (
      <div className="p-4 pb-20 sm:pb-4 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">{t('portalTitle')}</h1>
        <p className="text-sm text-slate-500">{t('noActiveUnit')}</p>
      </div>
    );
  }

  const [visitors, authorized] = await Promise.all([
    listVisitorLogs(ctx.orgId, { unitId: tenantUnit.unitId }),
    listAuthorizedVisitors(ctx.orgId, tenantUnit.unitId),
  ]);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">{t('portalTitle')}</h1>
        <Link href="/portal/visitors/new" className="text-sm font-medium text-brand-600 hover:underline">{t('registerVisitor')}</Link>
      </div>

      <Card padding="md" className="space-y-3">
        <h2 className="text-base font-medium text-slate-800">{t('recentVisits')}</h2>
        {visitors.length === 0 ? (
          <p className="text-sm text-slate-500">{t('emptyVisits')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visitors.map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{visit.visitorName}</p>
                  <p className="text-slate-500">{[visit.visitDate, visit.purpose].filter(Boolean).join(' · ')}</p>
                </div>
                {visit.passphrase && <span className="font-mono text-slate-700">{visit.passphrase}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AuthorizedVisitorsCard rows={authorized} />
    </div>
  );
}
