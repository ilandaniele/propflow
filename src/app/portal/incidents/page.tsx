import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, incidents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Card } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = { title: 'My Incidents' };

export default async function PortalIncidentsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const tenantRecord = tenantRows[0] ?? null;

  const incidentRows = tenantRecord
    ? await db
        .select({
          id:        incidents.id,
          title:     incidents.title,
          status:    incidents.status,
          priority:  incidents.priority,
          category:  incidents.category,
          createdAt: incidents.createdAt,
        })
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantRecord.id), eq(incidents.orgId, ctx.orgId)))
        .orderBy(desc(incidents.createdAt))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">My Incidents</h1>
        <Link href="/portal/incidents/new">
          <Button size="sm">Report Issue</Button>
        </Link>
      </div>

      {incidentRows.length === 0 ? (
        <Card>
          <EmptyState
            title="No incidents"
            description="Report a maintenance issue or problem with your unit."
            action={{ label: 'Report an issue', href: '/portal/incidents/new' }}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {incidentRows.map((incident) => (
            <Link key={incident.id} href={`/portal/incidents/${incident.id}`} className="block">
              <Card padding="sm" className="hover:border-brand-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <PriorityPill priority={incident.priority} />
                      <span className="text-xs text-slate-400 capitalize">{incident.category}</span>
                    </div>
                    <p className="font-medium text-slate-900 text-sm truncate">{incident.title}</p>
                    <p className="text-xs text-slate-400">
                      {incident.createdAt ? new Date(incident.createdAt).toLocaleDateString() : '—'}
                    </p>
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
