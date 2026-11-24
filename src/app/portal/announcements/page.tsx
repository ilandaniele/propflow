import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, units } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { listTenantAnnouncements } from '@/lib/announcements/queries';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';

export default async function PortalAnnouncementsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  // Look up tenant's unit/property to apply audience filter
  const tenantRows = await db
    .select({ unitId: tenants.unitId, propertyId: units.propertyId })
    .from(tenants)
    .leftJoin(units, and(eq(units.id, tenants.unitId), eq(units.orgId, ctx.orgId)))
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const tenantRecord = tenantRows[0] ?? null;
  const list = await listTenantAnnouncements(ctx.orgId, {
    propertyId: tenantRecord?.propertyId ?? null,
    unitId: tenantRecord?.unitId ?? null,
  });

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Announcements</h1>

      {list.length === 0 ? (
        <EmptyState title="No announcements" description="Announcements from your landlord will appear here." />
      ) : (
        <div className="space-y-3">
          {list.map((ann) => (
            <Card key={ann.id} padding="md" className={ann.important ? 'border-amber-300 bg-amber-50' : undefined}>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-medium text-slate-900">{ann.title}</h2>
                {ann.pinned && <Badge variant="info">Pinned</Badge>}
                {ann.important && <Badge variant="warning">Important</Badge>}
              </div>
              {/* Plain text rendering — no dangerouslySetInnerHTML (IC-E2) */}
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{ann.body}</p>
              <p className="mt-2 text-xs text-slate-400">
                {ann.publishedAt ? new Date(ann.publishedAt).toLocaleDateString() : ''}
                {ann.expiresAt ? ` · Expires ${new Date(ann.expiresAt).toLocaleDateString()}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
