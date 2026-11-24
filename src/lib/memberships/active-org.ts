import { cookies } from 'next/headers';
import { findMembership } from './queries';
import type { MemberRole } from './schemas';

export const ACTIVE_ORG_COOKIE = 'pf_active_org';

interface HomeOrg {
  org_id: string;
  role: MemberRole;
}

async function readActiveOrgCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export async function resolveActiveOrg<T extends HomeOrg>(userId: string, home: T): Promise<T> {
  const requested = await readActiveOrgCookie();
  if (!requested || requested === home.org_id) return home;
  const membership = await findMembership(userId, requested);
  return membership ? { ...home, org_id: membership.orgId, role: membership.role } : home;
}
