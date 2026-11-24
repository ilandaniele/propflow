import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ownerAssistantLinks, profiles } from '@/lib/db/schema';
import { isUniqueViolation } from '@/lib/db/errors';
import { sha256Hex } from '@/lib/whatsapp/dedupe';

const CODE_TTL_MS = 15 * 60_000;
export const MAX_LINK_ATTEMPTS = 5;

export type LinkVerification = 'verified' | 'invalid' | 'expired' | 'locked' | 'none';

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

const hashCode = (code: string) => sha256Hex(Buffer.from(code));

/** Starts (or restarts) linking a phone to the admin. Null when another admin of the org already uses that phone. */
export async function requestLinkCode(orgId: string, profileId: string, phoneE164: string): Promise<{ code: string; expiresAt: Date } | null> {
  const code = newCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const fields = { phoneE164, codeHash: hashCode(code), codeExpiresAt: expiresAt, attempts: 0, verifiedAt: null, updatedAt: now };
  try {
    await db
      .insert(ownerAssistantLinks)
      .values({ orgId, profileId, ...fields, createdAt: now })
      .onConflictDoUpdate({ target: ownerAssistantLinks.profileId, set: fields });
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
  return { code, expiresAt };
}

export async function getLinkForProfile(profileId: string) {
  const rows = await db
    .select({ phoneE164: ownerAssistantLinks.phoneE164, verifiedAt: ownerAssistantLinks.verifiedAt, codeExpiresAt: ownerAssistantLinks.codeExpiresAt })
    .from(ownerAssistantLinks)
    .where(eq(ownerAssistantLinks.profileId, profileId))
    .limit(1);
  return rows[0] ?? null;
}

export async function unlinkProfile(orgId: string, profileId: string): Promise<void> {
  await db.delete(ownerAssistantLinks).where(and(eq(ownerAssistantLinks.orgId, orgId), eq(ownerAssistantLinks.profileId, profileId)));
}

/** A verified link whose profile is still an admin of the org. */
export async function findVerifiedLink(orgId: string, phoneE164: string): Promise<{ id: string; profileId: string } | null> {
  const rows = await db
    .select({ id: ownerAssistantLinks.id, profileId: ownerAssistantLinks.profileId })
    .from(ownerAssistantLinks)
    .innerJoin(profiles, eq(profiles.id, ownerAssistantLinks.profileId))
    .where(and(
      eq(ownerAssistantLinks.orgId, orgId),
      eq(ownerAssistantLinks.phoneE164, phoneE164),
      isNotNull(ownerAssistantLinks.verifiedAt),
      eq(profiles.orgId, orgId),
      eq(profiles.role, 'admin'),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function verifyLinkCode(orgId: string, phoneE164: string, code: string, now = new Date()): Promise<LinkVerification> {
  const rows = await db
    .update(ownerAssistantLinks)
    .set({ attempts: sql`${ownerAssistantLinks.attempts} + 1`, updatedAt: now })
    .where(and(eq(ownerAssistantLinks.orgId, orgId), eq(ownerAssistantLinks.phoneE164, phoneE164), isNotNull(ownerAssistantLinks.codeHash)))
    .returning({ id: ownerAssistantLinks.id, codeHash: ownerAssistantLinks.codeHash, expiresAt: ownerAssistantLinks.codeExpiresAt, attempts: ownerAssistantLinks.attempts });
  const link = rows[0];
  if (!link) return 'none';
  if (link.attempts > MAX_LINK_ATTEMPTS) return 'locked';
  if (!link.expiresAt || link.expiresAt.getTime() < now.getTime()) return 'expired';
  if (link.codeHash !== hashCode(code)) return 'invalid';

  await db
    .update(ownerAssistantLinks)
    .set({ verifiedAt: now, codeHash: null, codeExpiresAt: null, attempts: 0, updatedAt: now })
    .where(eq(ownerAssistantLinks.id, link.id));
  return 'verified';
}
