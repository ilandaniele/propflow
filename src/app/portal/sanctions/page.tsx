import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'My Sanctions' };

export default async function PortalSanctionsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) redirect('/portal');

  const { data: sanctions } = await supabase
    .from('sanctions')
    .select('id, kind, title, reason, amount, status, created_at, dispute_reason')
    .eq('tenant_id', tenant.id)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Sanctions</h1>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(sanctions ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No sanctions on your account</div>
        ) : (
          (sanctions ?? []).map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    <Badge variant={s.kind === 'monetary' ? 'danger' : 'warning'}>{s.kind}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{s.reason}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.amount && <span className="text-sm font-medium">${Number(s.amount).toLocaleString()}</span>}
                  <Badge variant={
                    s.status === 'approved' ? 'danger' :
                    s.status === 'disputed' ? 'warning' :
                    s.status === 'resolved' ? 'success' :
                    'default'
                  }>
                    {s.status}
                  </Badge>
                </div>
              </div>
              {/* Dispute button for approved sanctions */}
              {s.status === 'approved' && (
                <div className="mt-2">
                  <Link
                    href={`/portal/sanctions/${s.id}/dispute`}
                    className="text-xs text-brand-600 hover:text-brand-800 underline font-medium"
                  >
                    Dispute this sanction
                  </Link>
                </div>
              )}
              {s.dispute_reason && (
                <p className="text-xs text-amber-600 mt-1">Dispute: {s.dispute_reason}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
