import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { PriorityLegend } from '@/components/incidents/PriorityLegend';

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: incidents } = await supabase
    .from('incidents')
    .select('*, profiles!incidents_created_by_fkey(full_name), tenants(full_name)')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const list = incidents ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incidents</h1>
          <p className="text-sm text-slate-500 mt-1">{list.length} total</p>
        </div>
      </div>

      <PriorityLegend />

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title="No incidents yet"
            description="Incidents reported by tenants will appear here. You can also create incidents directly."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((incident) => {
            const createdBy = incident.profiles as { full_name: string | null } | null;
            return (
              <Link key={incident.id} href={`/dashboard/incidents/${incident.id}`} className="block">
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 hover:border-violet-300 hover:shadow-md transition-all duration-150 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <PriorityPill priority={incident.priority} />
                      <span className="text-xs text-slate-400 capitalize">{incident.category}</span>
                    </div>
                    <p className="font-medium text-slate-900 text-sm truncate">{incident.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {createdBy?.full_name ?? 'Unknown'} · {new Date(incident.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusPill status={incident.status} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
