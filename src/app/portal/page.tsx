import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
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

  const supabase = await createClient();

  // Get tenant record for this user
  const { data: tenantRecord } = await supabase
    .from('tenants')
    .select('id, full_name, unit_id, units(label, properties(name))')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenantRecord) {
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

  const [contractRes, statementRes, incidentsRes, recentPaymentsRes, unitImagesRes] = await Promise.all([
    supabase.from('contracts').select('*').eq('tenant_id', tenantRecord.id).eq('status', 'active').eq('org_id', ctx.orgId).single(),
    supabase.from('tenant_statement').select('*').eq('tenant_id', tenantRecord.id).single(),
    supabase.from('incidents').select('id, title, status, created_at').eq('tenant_id', tenantRecord.id).eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(3),
    supabase.from('payments').select('*').eq('tenant_id', tenantRecord.id).eq('org_id', ctx.orgId).order('paid_at', { ascending: false }).limit(3),
    getUnitImagesTenant(),
  ]);

  const contract = contractRes.data;
  const statement = statementRes.data;
  const incidents = incidentsRes.data ?? [];
  const recentPayments = recentPaymentsRes.data ?? [];
  const unitImages = unitImagesRes.data ?? [];
  const unit = tenantRecord.units as unknown as { label: string; properties: { name: string } | null } | null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Welcome back, {ctx.profile.full_name?.split(' ')[0] ?? 'Tenant'}</h1>
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
                <p className={`text-3xl font-bold ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {statement.balance < 0 ? '-' : '+'}${Math.abs(statement.balance).toLocaleString()}
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
              <p className="font-semibold text-slate-900">${contract.monthly_rent.toLocaleString()}/month</p>
              <p className="text-xs text-slate-500 mt-0.5">{contract.start_date} → {contract.end_date}</p>
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
                    <p className="font-semibold text-slate-900 text-sm">${p.amount.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{p.paid_at} · {p.method}</p>
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
        {incidents.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-slate-400">No incidents reported</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {incidents.map((i) => (
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
