import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';

export function listApiKeys(orgId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId))
    .orderBy(desc(apiKeys.createdAt))
    .limit(100);
}

export async function insertApiKey(values: { orgId: string; name: string; prefix: string; keyHash: string; createdBy: string }) {
  const [row] = await db.insert(apiKeys).values(values).returning({ id: apiKeys.id });
  return row;
}

export async function revokeApiKey(orgId: string, id: string) {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

export async function claimActiveApiKey(keyHash: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, orgId: apiKeys.orgId });
  return row ?? null;
}
