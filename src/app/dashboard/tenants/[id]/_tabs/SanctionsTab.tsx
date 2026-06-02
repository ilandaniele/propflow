import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches sanctions for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function SanctionsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data } = await supabase
    .from('sanctions')
    .select('id, kind, title, reason, amount, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const sanctions = data ?? [];

  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>Sanctions</CardTitle></CardHeader>
        {sanctions.length === 0 ? (
          <p className="text-sm text-slate-400">No sanctions</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {sanctions.map((s) => (
              <div key={s.id} className="py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    <Badge variant={s.kind === 'monetary' ? 'danger' : 'warning'}>
                      {s.kind}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{s.reason}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.amount && (
                    <span className="text-sm font-medium text-slate-900">
                      ${Number(s.amount).toLocaleString()}
                    </span>
                  )}
                  <Badge
                    variant={
                      s.status === 'approved' ? 'danger' :
                      s.status === 'disputed' ? 'warning' :
                      s.status === 'resolved' ? 'success' :
                      'default'
                    }
                  >
                    {s.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
