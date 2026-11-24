import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pollOptions, polls, pollVotes } from '@/lib/db/schema';
import { groupPollResults } from './results';

const RECENT_POLLS_LIMIT = 30;

export async function listPollResults(orgId: string, viewerProfileId: string) {
  const recentPolls = db
    .select({ id: polls.id })
    .from(polls)
    .where(eq(polls.orgId, orgId))
    .orderBy(desc(polls.createdAt))
    .limit(RECENT_POLLS_LIMIT);

  const rows = await db
    .select({
      pollId: polls.id,
      question: polls.question,
      closesAt: polls.closesAt,
      createdAt: polls.createdAt,
      optionId: pollOptions.id,
      label: pollOptions.label,
      position: pollOptions.position,
      votes: sql<number>`count(${pollVotes.id})`,
      votedByViewer: sql<number>`sum(case when ${pollVotes.profileId} = ${viewerProfileId} then 1 else 0 end)`,
    })
    .from(polls)
    .innerJoin(pollOptions, eq(pollOptions.pollId, polls.id))
    .leftJoin(pollVotes, eq(pollVotes.optionId, pollOptions.id))
    .where(and(eq(polls.orgId, orgId), sql`${polls.id} in ${recentPolls}`))
    .groupBy(polls.id, pollOptions.id)
    .orderBy(desc(polls.createdAt), asc(pollOptions.position));

  return groupPollResults(
    rows.map((row) => ({ ...row, votes: Number(row.votes), votedByViewer: Number(row.votedByViewer ?? 0) })),
    new Date(),
  );
}

export async function insertPoll(input: { orgId: string; createdBy: string; question: string; options: string[]; closesAt: Date | null }) {
  const pollId = crypto.randomUUID();
  await db.batch([
    db.insert(polls).values({ id: pollId, orgId: input.orgId, createdBy: input.createdBy, question: input.question, closesAt: input.closesAt }),
    db.insert(pollOptions).values(input.options.map((label, position) => ({ pollId, label, position }))),
  ]);
  return pollId;
}

export async function closePoll(orgId: string, pollId: string) {
  const rows = await db
    .update(polls)
    .set({ closesAt: new Date() })
    .where(and(eq(polls.id, pollId), eq(polls.orgId, orgId), or(isNull(polls.closesAt), gt(polls.closesAt, new Date()))))
    .returning({ id: polls.id });
  return rows.length > 0;
}

export type CastVoteOutcome = 'voted' | 'not_found' | 'closed' | 'already_voted';

export async function castVote(input: { orgId: string; pollId: string; optionId: string; profileId: string }): Promise<CastVoteOutcome> {
  const [target] = await db
    .select({ closesAt: polls.closesAt })
    .from(pollOptions)
    .innerJoin(polls, eq(polls.id, pollOptions.pollId))
    .where(and(eq(pollOptions.id, input.optionId), eq(polls.id, input.pollId), eq(polls.orgId, input.orgId)))
    .limit(1);
  if (!target) return 'not_found';
  if (target.closesAt && target.closesAt <= new Date()) return 'closed';

  const inserted = await db
    .insert(pollVotes)
    .values({ pollId: input.pollId, optionId: input.optionId, profileId: input.profileId })
    .onConflictDoNothing()
    .returning({ id: pollVotes.id });
  return inserted.length > 0 ? 'voted' : 'already_voted';
}
