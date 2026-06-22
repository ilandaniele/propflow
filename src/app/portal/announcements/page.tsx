import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, units, announcements } from '@/lib/db/schema';
import { eq, and, isNotNull, lte, or, sql } from 'drizzle-orm';
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
  const tenantUnitId = tenantRecord?.unitId ?? null;
  const tenantPropertyId = tenantRecord?.propertyId ?? null;

  const now = new Date();

  // Replicate RLS audience filter: published, not expired, audience matches tenant
  const rows = await db
    .select({
      id:          announcements.id,
      title:       announcements.title,
      body:        announcements.body,
      publishedAt: announcements.publishedAt,
      expiresAt:   announcements.expiresAt,
      audience:    announcements.audience,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.orgId, ctx.orgId),
        isNotNull(announcements.publishedAt),
        lte(announcements.publishedAt, now),
        or(
          eq(announcements.audience, 'all'),
          tenantPropertyId
            ? and(eq(announcements.audience, 'property'), eq(announcements.propertyId, tenantPropertyId))
            : sql`false`,
          tenantUnitId
            ? and(eq(announcements.audience, 'unit'), eq(announcements.unitId, tenantUnitId))
            : sql`false`,
        ),
      ),
    )
    .orderBy(announcements.publishedAt)
    .limit(25);

  // Reverse to get descending order (Drizzle desc() on nullable timestamps is tricky)
  const list = rows.slice().reverse();

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Announcements</h1>

      {list.length === 0 ? (
        <EmptyState title="No announcements" description="Announcements from your landlord will appear here." />
      ) : (
        <div className="space-y-3">
          {list.map((ann) => (
            <Card key={ann.id} padding="md">
              <h2 className="font-medium text-slate-900">{ann.title}</h2>
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
