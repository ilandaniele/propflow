'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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

  const supabase = await createClient();
  const { error } = await supabase.from('community_posts').insert({
    org_id: ctx.orgId,
    author_id: ctx.userId,   // server-derived; never trust client-supplied author_id
    title: parsed.data.title,
    body: parsed.data.body,
    category: parsed.data.category,
    pinned: false,           // pinned is admin-only; always false on create
  });

  if (error) {
    log.error('[createCommunityPost] db error', { code: error.code });
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

  const supabase = await createClient();

  // Admin can update any; tenant can only update own non-pinned posts
  const { data: existing } = await supabase
    .from('community_posts').select('id, author_id, pinned').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  if (ctx.role === 'tenant') {
    if (existing.author_id !== ctx.userId) return Errors.NOT_FOUND();
    if (existing.pinned) return Errors.FORBIDDEN();
  }

  const { id, ...updates } = parsed.data;
  const { error } = await supabase.from('community_posts').update({
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateCommunityPost] db error', { code: error.code });
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

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('community_posts').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { error } = await supabase.from('community_posts').update({
    pinned: parsed.data.pinned,
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[pinPost] db error', { code: error.code });
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

  const supabase = await createClient();

  // Verify the post exists and belongs to the org
  const { data: post } = await supabase
    .from('community_posts').select('id, author_id').eq('id', parsed.data.post_id).eq('org_id', ctx.orgId).single();
  if (!post) return Errors.NOT_FOUND();

  const { data: comment, error } = await supabase.from('community_comments').insert({
    org_id: ctx.orgId,
    post_id: parsed.data.post_id,
    author_id: ctx.userId,  // server-derived
    body: parsed.data.body,
  }).select('id').single();

  if (error || !comment) {
    log.error('[addCommunityComment] db error', { code: error?.code });
    return Errors.INTERNAL();
  }

  // Write notification_inbox to post author if they're not the commenter
  if (post.author_id !== ctx.userId) {
    await supabase.from('notification_inbox').insert({
      org_id: ctx.orgId,
      profile_id: post.author_id,
      type: 'community_reply',
      title: 'New reply on your post',
      body: parsed.data.body.slice(0, 200),
      related_type: 'community_post',
      related_id: parsed.data.post_id,
    }).then(() => {}); // non-fatal if fails
  }

  revalidatePath('/dashboard/community');
  revalidatePath('/portal/community');
  return ok(undefined);
}
