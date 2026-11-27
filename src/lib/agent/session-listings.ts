/**
 * agent_session_listings (Phase 9) — every listing id a session has actually
 * been shown, whether via search_listings, the session's own attribution
 * (Meta CTWA/wa.me deep link) or a web page-context. This is the only
 * allow-list send_listing_card / send_listing_photos may act on: the model
 * itself is never trusted to supply an arbitrary listing id.
 */

import { db } from '@/lib/db';
import { agentSessionListings, agentSessions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { AgentAttribution } from './types';

export type SessionListingSource = 'search' | 'attribution' | 'page';

/** Idempotent — a listing already recorded for this session is a no-op. */
export async function rememberSessionListings(
  orgId: string,
  sessionId: string,
  listingIds: string[],
  source: SessionListingSource,
): Promise<void> {
  const ids = [...new Set(listingIds)].filter(Boolean);
  if (ids.length === 0) return;

  await db
    .insert(agentSessionListings)
    .values(ids.map((listingId) => ({ sessionId, orgId, listingId, source })))
    .onConflictDoNothing({ target: [agentSessionListings.sessionId, agentSessionListings.listingId] });
}

/**
 * True if this session either has a recorded sighting of the listing, or the
 * session's own stored attribution (set once, on its first attributed
 * inbound) points at it — the latter covers the very first turn, before
 * search_listings has ever run.
 */
export async function isListingKnownToSession(orgId: string, sessionId: string, listingId: string): Promise<boolean> {
  const seenRows = await db
    .select({ listingId: agentSessionListings.listingId })
    .from(agentSessionListings)
    .where(and(
      eq(agentSessionListings.orgId, orgId),
      eq(agentSessionListings.sessionId, sessionId),
      eq(agentSessionListings.listingId, listingId),
    ))
    .limit(1);
  if (seenRows.length > 0) return true;

  const sessionRows = await db
    .select({ attribution: agentSessions.attribution })
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.orgId, orgId)))
    .limit(1);
  const attribution = sessionRows[0]?.attribution as AgentAttribution | null | undefined;
  return attribution?.listingId === listingId;
}
