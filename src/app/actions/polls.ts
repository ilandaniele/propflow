'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, err } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { CastVoteSchema, CreatePollSchema, PollIdSchema, endOfDay } from '@/lib/polls/schemas';
import { castVote, closePoll, insertPoll } from '@/lib/polls/queries';

const ADMIN_PATH = '/dashboard/polls';
const PORTAL_PATH = '/portal/polls';

function failure(scope: string, error: unknown): ActionResult<never> {
  log.error(`polls.${scope}_failed`, { error: error instanceof Error ? error.message : String(error) });
  return Errors.INTERNAL();
}

export async function createPoll(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-poll').success) return Errors.RATE_LIMITED();

  const parsed = CreatePollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const pollId = await insertPoll({
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      question: parsed.data.question,
      options: parsed.data.options,
      closesAt: parsed.data.closes_on ? endOfDay(parsed.data.closes_on) : null,
    });
    log.adminAction(ctx.userId, 'create_poll', 'poll', pollId);
    revalidatePath(ADMIN_PATH);
    revalidatePath(PORTAL_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('create', error);
  }
}

export async function closePollAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'close-poll').success) return Errors.RATE_LIMITED();

  const parsed = PollIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    if (!(await closePoll(ctx.orgId, parsed.data.poll_id))) return Errors.NOT_FOUND();
    log.adminAction(ctx.userId, 'close_poll', 'poll', parsed.data.poll_id);
    revalidatePath(ADMIN_PATH);
    revalidatePath(PORTAL_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('close', error);
  }
}

export async function voteInPoll(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'vote-poll').success) return Errors.RATE_LIMITED();

  const parsed = CastVoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const outcome = await castVote({ orgId: ctx.orgId, pollId: parsed.data.poll_id, optionId: parsed.data.option_id, profileId: ctx.userId });
    if (outcome === 'not_found') return Errors.NOT_FOUND();
    if (outcome === 'closed') return err('POLL_CLOSED', 'This poll is closed.');
    if (outcome === 'already_voted') return Errors.CONFLICT('You already voted in this poll.');
    revalidatePath(PORTAL_PATH);
    revalidatePath(ADMIN_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('vote', error);
  }
}
