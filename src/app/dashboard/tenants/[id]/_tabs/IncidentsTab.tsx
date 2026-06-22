import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import Link from 'next/link';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches incidents for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function IncidentsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data } = await supabase
    .from('incidents')
    .select('id, title, category, priority, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const incidents = data ?? [];
  const t = await getTranslations('tenantTabs.incidentsTab');

  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {incidents.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {incidents.map((i) => (
              <div key={i.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    href={`/dashboard/incidents/${i.id}`}
                    className="text-sm font-medium text-slate-900 hover:text-brand-600 transition-colors"
                  >
                    {i.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {i.category} · {new Date(i.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PriorityPill priority={i.priority} />
                  <StatusPill status={i.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
