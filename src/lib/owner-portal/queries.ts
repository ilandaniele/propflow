import crypto from 'crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ownerPortalLinks, owners } from '@/lib/db/schema';
import { sha256 } from '@/lib/crypto/hash';

const LINK_TTL_MS = 90 * 24 * 60 * 60_000;

const activeLink = (now: Date) => and(isNull(ownerPortalLinks.revokedAt), gt(ownerPortalLinks.expiresAt, now));

export async function createOwnerPortalLink(orgId: string, ownerId: string, createdBy: string) {
  const [owner] = await db
    .select({ id: owners.id })
    .from(owners)
    .where(and(eq(owners.id, ownerId), eq(owners.orgId, orgId)));
  if (!owner) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  await db.batch([
    db
      .update(ownerPortalLinks)
      .set({ revokedAt: now })
      .where(and(eq(ownerPortalLinks.orgId, orgId), eq(ownerPortalLinks.ownerId, ownerId), activeLink(now))),
    db.insert(ownerPortalLinks).values({ orgId, ownerId, tokenHash: sha256(token), createdBy, expiresAt }),
  ]);
  return { token, expiresAt };
}

export async function revokeOwnerPortalLink(orgId: string, linkId: string) {
  const revoked = await db
    .update(ownerPortalLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(ownerPortalLinks.id, linkId), eq(ownerPortalLinks.orgId, orgId), isNull(ownerPortalLinks.revokedAt)))
    .returning({ id: ownerPortalLinks.id });
  return revoked.length > 0;
}

export async function resolveOwnerPortalLink(token: string) {
  const now = new Date();
  const [link] = await db
    .update(ownerPortalLinks)
    .set({ lastViewedAt: now })
    .where(and(eq(ownerPortalLinks.tokenHash, sha256(token)), activeLink(now)))
    .returning({ orgId: ownerPortalLinks.orgId, ownerId: ownerPortalLinks.ownerId });
  if (!link) return null;
  const [owner] = await db.select({ name: owners.name }).from(owners).where(eq(owners.id, link.ownerId));
  return { ...link, ownerName: owner?.name ?? null };
}

export async function listOwnerPortalLinks(orgId: string) {
  return db
    .select({
      id: ownerPortalLinks.id,
      ownerName: owners.name,
      expiresAt: ownerPortalLinks.expiresAt,
      lastViewedAt: ownerPortalLinks.lastViewedAt,
    })
    .from(ownerPortalLinks)
    .innerJoin(owners, eq(owners.id, ownerPortalLinks.ownerId))
    .where(and(eq(ownerPortalLinks.orgId, orgId), activeLink(new Date())))
    .orderBy(desc(ownerPortalLinks.createdAt))
    .limit(200);
}
