import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPortalPreviewVisitors } from '@/lib/portal-preview/queries';

interface Props {
  tenantId: string;
  /** Passed for documentation — actual orgId is sourced from requireAdmin() ctx for security. */
  orgId: string;
}

/**
 * Async Server Component — read-only table of visitor_logs scoped to this tenant.
 * Uses the AC7-compliant helper: .eq('host_tenant_id', tenantId) AND .eq('org_id', orgId).
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function VisitorsSection({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');
  const supabase = await createClient();

  const visitors = await getPortalPreviewVisitors(supabase, tenantId, ctx.orgId);

  return (
    <Card data-testid="portal-preview-visitors">
      <CardHeader>
        <CardTitle>{t('portalPreview.sections.visitors')}</CardTitle>
      </CardHeader>
      {visitors.length === 0 ? (
        <p className="text-sm text-slate-400">{t('portalPreview.visitors.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500">
                  {t('portalPreview.visitors.date')}
                </th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500">
                  {t('portalPreview.visitors.name')}
                </th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500">
                  {t('portalPreview.visitors.purpose')}
                </th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500">
                  {t('portalPreview.visitors.entry')}
                </th>
                <th className="text-left py-2 text-xs font-medium text-slate-500">
                  {t('portalPreview.visitors.exit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visitors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2 pr-4 text-slate-700">
                    {v.visit_date}
                  </td>
                  <td className="py-2 pr-4 font-medium text-slate-900">
                    {v.visitor_name}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {v.purpose ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {v.entry_time ?? '—'}
                  </td>
                  <td className="py-2 text-slate-600">
                    {v.exit_time ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
