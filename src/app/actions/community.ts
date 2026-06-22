'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { communityPosts, communityComments, notificationInbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import {
  CommunityPostSchema,
  UpdateCommunityPostSchema,
  PinPostSchema,
  CommunityCommentSchema,
} from '@/lib/schemas/community';

export async function createCommunityPost(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-community-post');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CommunityPostSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(communityPosts).values({
      orgId: ctx.orgId,
      authorId: ctx.userId,
      title: parsed.data.title,
      body: parsed.data.body,
      category: parsed.data.category,
      pinned: false,
    });
  } catch (e) {
    log.error('[createCommunityPost] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/community');
  revalidatePath('/portal/community');
  return ok(undefined);
}

export async function updateCommunityPost(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-community-post');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateCommunityPostSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Admin can update any; tenant can only update own non-pinned posts
  const existing = await db
    .select({ id: communityPosts.id, authorId: communityPosts.authorId, pinned: communityPosts.pinned })
    .from(communityPosts)
    .where(and(eq(communityPosts.id, parsed.data.id), eq(communityPosts.orgId, ctx.orgId)))
    .limit(1);

  if (!existing[0]) return Errors.NOT_FOUND();

  if (ctx.role === 'tenant') {
    if (existing[0].authorId !== ctx.userId) return Errors.NOT_FOUND();
    if (existing[0].pinned) return Errors.FORBIDDEN();
  }

  const { id, ...updates } = parsed.data;

  try {
    await db
      .update(communityPosts)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(communityPosts.id, id), eq(communityPosts.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateCommunityPost] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/community');
  revalidatePath('/portal/community');
  return ok(undefined);
}

export async function pinPost(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'pin-post');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = PinPostSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const existing = await db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(and(eq(communityPosts.id, parsed.data.id), eq(communityPosts.orgId, ctx.orgId)))
    .limit(1);

  if (!existing[0]) return Errors.NOT_FOUND();

  try {
    await db
      .update(communityPosts)
      .set({ pinned: parsed.data.pinned, updatedAt: new Date() })
      .where(and(eq(communityPosts.id, parsed.data.id), eq(communityPosts.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[pinPost] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/community');
  revalidatePath('/portal/community');
  return ok(undefined);
}

export async function addCommunityComment(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'add-community-comment');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CommunityCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify the post exists and belongs to the org
  const postRows = await db
    .select({ id: communityPosts.id, authorId: communityPosts.authorId })
    .from(communityPosts)
    .where(and(eq(communityPosts.id, parsed.data.post_id), eq(communityPosts.orgId, ctx.orgId)))
    .limit(1);

  if (!postRows[0]) return Errors.NOT_FOUND();

  try {
    await db.insert(communityComments).values({
      orgId: ctx.orgId,
      postId: parsed.data.post_id,
      authorId: ctx.userId,
      body: parsed.data.body,
    });
  } catch (e) {
    log.error('[addCommunityComment] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  // Write notification_inbox to post author if they're not the commenter
  if (postRows[0].authorId !== ctx.userId) {
    await db.insert(notificationInbox).values({
      orgId: ctx.orgId,
      profileId: postRows[0].authorId,
      type: 'community_reply',
      title: 'New reply on your post',
      body: parsed.data.body.slice(0, 200),
      relatedType: 'community_post',
      relatedId: parsed.data.post_id,
    }).catch(() => undefined);
  }

  revalidatePath('/dashboard/community');
  revalidatePath('/portal/community');
  return ok(undefined);
}
