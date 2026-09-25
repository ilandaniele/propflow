/**
 * Resolves a listing "ref" (from a widget's data-listing-ref, a page's
 * ref_code, or a public_slug in a URL) to the page-context the agent turn
 * is told about. Published + available only — never leaks reserved/closed
 * or unpublished inventory.
 */

import { db } from '@/lib/db';
import { listings } from '@/lib/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import type { AgentPageContext } from '@/lib/agent/types';

export async function resolveListingRef(orgId: string, ref: string | null): Promise<AgentPageContext | null> {
  if (!ref || !ref.trim()) return null;

  const rows = await db
    .select({ id: listings.id, title: listings.title, refCode: listings.refCode, publicSlug: listings.publicSlug })
    .from(listings)
    .where(and(
      eq(listings.orgId, orgId),
      eq(listings.published, true),
      eq(listings.status, 'available'),
      or(sql`lower(${listings.refCode}) = lower(${ref})`, eq(listings.publicSlug, ref)),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { listingId: row.id, title: row.title, refCode: row.refCode, publicSlug: row.publicSlug };
}
