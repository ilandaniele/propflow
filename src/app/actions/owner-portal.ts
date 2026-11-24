'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { OwnerPortalLinkSchema, RevokeOwnerPortalLinkSchema } from '@/lib/schemas/owner-settlement';
import { createOwnerPortalLink, revokeOwnerPortalLink } from '@/lib/owner-portal/queries';

const SETTLEMENTS_PATH = '/dashboard/finance/owner-settlements';

export async function createOwnerPortalLinkAction(
  _prev: ActionResult<{ url: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'owner_portal_link').success) return Errors.RATE_LIMITED();

  const parsed = OwnerPortalLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const link = await createOwnerPortalLink(ctx.orgId, parsed.data.owner_id, ctx.userId);
  if (!link) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'owner_portal_link_create', 'owner', parsed.data.owner_id);
  revalidatePath(SETTLEMENTS_PATH);
  const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';
  return ok({ url: `${siteUrl}/owner/${link.token}` });
}

export async function revokeOwnerPortalLinkAction(formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'owner_portal_link').success) return Errors.RATE_LIMITED();

  const parsed = RevokeOwnerPortalLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await revokeOwnerPortalLink(ctx.orgId, parsed.data.link_id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'owner_portal_link_revoke', 'owner_portal_link', parsed.data.link_id);
  revalidatePath(SETTLEMENTS_PATH);
  return ok(undefined);
}
