import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPortalPreviewVisitors } from '@/lib/portal-preview/queries';

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
 * Shows tenant name, unit, property, monthly rent, and visitor count (last 30 days).
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function PortalHomeSection({ tenant }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');
  const supabase = await createClient();

  // Fetch active contract for monthly_rent
  const { data: contract } = await supabase
    .from('contracts')
    .select('monthly_rent, status, start_date, end_date')
    .eq('tenant_id', tenant.id)
    .eq('org_id', ctx.orgId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single();

  // Visitor count for last 30 days — reuses the scoped helper (AC7)
  const allVisitors = await getPortalPreviewVisitors(supabase, tenant.id, ctx.orgId);
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
              ${Number(contract.monthly_rent).toLocaleString()}/mo
            </dd>
          </div>
        )}
        <div className="flex justify-between border-t pt-2 mt-2">
          <dt className="text-slate-500">{t('portalPreview.home.visitorCount')}</dt>
          <dd className="font-medium text-slate-900">{recentVisitorCount}</dd>
        </div>
      </dl>
    </Card>
  );
}
