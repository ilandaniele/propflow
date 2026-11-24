'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/db/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { ACTIVE_ORG_COOKIE } from '@/lib/memberships/active-org';
import { deleteMembership, findUserByEmail, insertMembership, listUserCommunities } from '@/lib/memberships/queries';
import { AddMemberSchema, RemoveMemberSchema, SwitchCommunitySchema } from '@/lib/memberships/schemas';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const MEMBERS_PATH = '/dashboard/communities';
const ALREADY_MEMBER = 'User already belongs to this community';

export async function switchCommunity(formData: FormData): Promise<void> {
  let ctx;
  try { ctx = await requireUser(); } catch { redirect('/login'); }
  if (!mutationRateLimit(ctx.userId, 'switch-community').success) return;

  const parsed = SwitchCommunitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const communities = await listUserCommunities(ctx.userId);
  const target = communities.find((c) => c.orgId === parsed.data.org_id);
  if (!target) return;

  (await cookies()).set(ACTIVE_ORG_COOKIE, target.orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
  });
  redirect(target.role === 'admin' ? '/dashboard' : '/portal');
}

export async function addCommunityMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'add-community-member').success) return Errors.RATE_LIMITED();

  const parsed = AddMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const user = await findUserByEmail(parsed.data.email);
  if (!user) return Errors.NOT_FOUND();
  if (user.homeOrgId === ctx.orgId) return Errors.CONFLICT(ALREADY_MEMBER);

  try {
    await insertMembership({ userId: user.id, orgId: ctx.orgId, role: parsed.data.role });
  } catch (e) {
    if (isUniqueViolation(e)) return Errors.CONFLICT(ALREADY_MEMBER);
    log.error('[addCommunityMember] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'add_community_member', 'org_membership');
  revalidatePath(MEMBERS_PATH);
  return ok(undefined);
}

export async function removeCommunityMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'remove-community-member').success) return Errors.RATE_LIMITED();

  const parsed = RemoveMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deleteMembership(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_community_member', 'org_membership', parsed.data.id);
  revalidatePath(MEMBERS_PATH);
  return ok(undefined);
}
