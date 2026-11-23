import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { orgMemberships, organizations, profiles, users } from '@/lib/db/schema';
import { equalsIgnoreCase } from '@/lib/db/like';
import type { MemberRole } from './schemas';

export interface Community {
  orgId: string;
  name: string;
  role: MemberRole;
}

const MEMBERS_LIMIT = 200;

export async function findMembership(userId: string, orgId: string) {
  const rows = await db.select({ role: orgMemberships.role }).from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId))).limit(1);
  return rows[0] ? { orgId, role: rows[0].role as MemberRole } : null;
}

export async function listUserCommunities(userId: string): Promise<Community[]> {
  const [home, extra] = await Promise.all([
    db.select({ orgId: profiles.orgId, name: organizations.name, role: profiles.role })
      .from(profiles).innerJoin(organizations, eq(organizations.id, profiles.orgId))
      .where(eq(profiles.userId, userId)).limit(1),
    db.select({ orgId: orgMemberships.orgId, name: organizations.name, role: orgMemberships.role })
      .from(orgMemberships).innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
      .where(eq(orgMemberships.userId, userId)).orderBy(asc(organizations.name)),
  ]);
  const seen = new Set<string>();
  return [...home, ...extra]
    .filter((c) => !seen.has(c.orgId) && seen.add(c.orgId))
    .map((c) => ({ ...c, role: c.role as MemberRole }));
}

export function listOrgMembers(orgId: string) {
  return db.select({ id: orgMemberships.id, role: orgMemberships.role, name: users.name, email: users.email })
    .from(orgMemberships).innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId)).orderBy(asc(users.email)).limit(MEMBERS_LIMIT);
}

export async function findUserByEmail(email: string) {
  const rows = await db.select({ id: users.id, homeOrgId: profiles.orgId })
    .from(users).leftJoin(profiles, eq(profiles.userId, users.id))
    .where(equalsIgnoreCase(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function insertMembership(values: { userId: string; orgId: string; role: MemberRole }) {
  await db.insert(orgMemberships).values(values);
}

export async function deleteMembership(orgId: string, id: string) {
  const rows = await db.delete(orgMemberships)
    .where(and(eq(orgMemberships.id, id), eq(orgMemberships.orgId, orgId)))
    .returning({ id: orgMemberships.id });
  return rows.length > 0;
}
