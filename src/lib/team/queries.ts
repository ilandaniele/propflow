import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profiles, staffRoles } from '@/lib/db/schema';
import { isStaffRole, type StaffRole } from '@/lib/auth/permissions';

export interface TeamMember {
  profileId: string;
  fullName: string | null;
  email: string | null;
  staffRole: StaffRole | null;
}

export async function listTeam(orgId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({ profileId: profiles.id, fullName: profiles.fullName, email: profiles.email, staffRole: staffRoles.role })
    .from(profiles)
    .leftJoin(staffRoles, eq(staffRoles.profileId, profiles.id))
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .orderBy(asc(profiles.fullName))
    .limit(200);
  return rows.map((r) => ({ ...r, staffRole: isStaffRole(r.staffRole) ? r.staffRole : null }));
}

/** Sets a restricted role, or clears it (full admin) when role is null. False if the profile is not an admin of the org. */
export async function setStaffRole(orgId: string, profileId: string, role: StaffRole | null, actorProfileId: string): Promise<boolean> {
  const target = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(1);
  if (!target[0]) return false;

  if (role === null) {
    await db.delete(staffRoles).where(and(eq(staffRoles.profileId, profileId), eq(staffRoles.orgId, orgId)));
    return true;
  }

  const now = new Date();
  await db
    .insert(staffRoles)
    .values({ orgId, profileId, role, createdBy: actorProfileId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: staffRoles.profileId, set: { role, updatedAt: now } });
  return true;
}
