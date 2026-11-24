import { and, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { announcements } from '@/lib/db/schema';

export interface TenantAudience {
  propertyId: string | null;
  unitId: string | null;
}

export async function listTenantAnnouncements(orgId: string, audience: TenantAudience, now: Date = new Date()) {
  return db
    .select({
      id:          announcements.id,
      title:       announcements.title,
      body:        announcements.body,
      publishedAt: announcements.publishedAt,
      expiresAt:   announcements.expiresAt,
      pinned:      announcements.pinned,
      important:   announcements.important,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.orgId, orgId),
        isNotNull(announcements.publishedAt),
        lte(announcements.publishedAt, now),
        or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
        or(
          eq(announcements.audience, 'all'),
          audience.propertyId
            ? and(eq(announcements.audience, 'property'), eq(announcements.propertyId, audience.propertyId))
            : sql`false`,
          audience.unitId
            ? and(eq(announcements.audience, 'unit'), eq(announcements.unitId, audience.unitId))
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
    .limit(25);
}

export async function setAnnouncementPinned(orgId: string, id: string, pinned: boolean): Promise<boolean> {
  const updated = await db
    .update(announcements)
    .set({ pinned, updatedAt: new Date() })
    .where(and(eq(announcements.id, id), eq(announcements.orgId, orgId)))
    .returning({ id: announcements.id });
  return updated.length > 0;
}
