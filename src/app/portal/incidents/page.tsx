import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = { title: 'My Incidents' };

export default async function PortalIncidentsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: tenantRecord } = await supabase
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  const { data: incidents } = await supabase
    .from('incidents')
    .select('*')
    .eq('org_id', ctx.orgId)
    .eq(tenantRecord ? 'tenant_id' : 'created_by', tenantRecord?.id ?? ctx.userId)
    .order('created_at', { ascending: false });

  const list = incidents ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">My Incidents</h1>
        <Link href="/portal/incidents/new">
          <Button size="sm">Report Issue</Button>
        </Link>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title="No incidents"
            description="Report a maintenance issue or problem with your unit."
            action={{ label: 'Report an issue', href: '/portal/incidents/new' }}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((incident) => (
            <Link key={incident.id} href={`/portal/incidents/${incident.id}`} className="block">
              <Card padding="sm" className="hover:border-violet-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <PriorityPill priority={incident.priority} />
                      <span className="text-xs text-slate-400 capitalize">{incident.category}</span>
                    </div>
                    <p className="font-medium text-slate-900 text-sm truncate">{incident.title}</p>
                    <p className="text-xs text-slate-400">{new Date(incident.created_at).toLocaleDateString()}</p>
                  </div>
                  <StatusPill status={incident.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
