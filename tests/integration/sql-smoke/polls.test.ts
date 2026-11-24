import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';
import { castVote, closePoll, insertPoll, listPollResults } from '@/lib/polls/queries';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedPollScenario() {
  const org = await seedOrg(smoke.db);
  const admin = await seedProfile(smoke.db, org.id, { role: 'admin', email: `admin-${crypto.randomUUID()}@example.com` });
  const resident = await seedProfile(smoke.db, org.id, { role: 'tenant', email: `res-${crypto.randomUUID()}@example.com` });
  const neighbour = await seedProfile(smoke.db, org.id, { role: 'tenant', email: `nb-${crypto.randomUUID()}@example.com` });
  const pollId = await insertPoll({ orgId: org.id, createdBy: admin.id, question: 'Paint the lobby?', options: ['Yes', 'No'], closesAt: null });
  const [poll] = await listPollResults(org.id, resident.id);
  return { org, admin, resident, neighbour, pollId, poll };
}

describe('polls (real SQL)', () => {
  it('inserts a poll with ordered options and zero votes', async () => {
    const { pollId, poll } = await seedPollScenario();
    expect(poll.id).toBe(pollId);
    expect(poll.isOpen).toBe(true);
    expect(poll.totalVotes).toBe(0);
    expect(poll.options.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('counts votes, marks the viewer choice and rejects a second vote', async () => {
    const { org, resident, neighbour, pollId, poll } = await seedPollScenario();
    const [yes, no] = poll.options;

    expect(await castVote({ orgId: org.id, pollId, optionId: yes.id, profileId: resident.id })).toBe('voted');
    expect(await castVote({ orgId: org.id, pollId, optionId: no.id, profileId: neighbour.id })).toBe('voted');
    expect(await castVote({ orgId: org.id, pollId, optionId: no.id, profileId: resident.id })).toBe('already_voted');

    const [after] = await listPollResults(org.id, resident.id);
    expect(after.totalVotes).toBe(2);
    expect(after.viewerOptionId).toBe(yes.id);
    expect(after.options.map((o) => o.percent)).toEqual([50, 50]);
  });

  it('refuses votes once the poll is closed', async () => {
    const { org, resident, pollId, poll } = await seedPollScenario();
    expect(await closePoll(org.id, pollId)).toBe(true);
    expect(await closePoll(org.id, pollId)).toBe(false);
    expect(await castVote({ orgId: org.id, pollId, optionId: poll.options[0].id, profileId: resident.id })).toBe('closed');
    const [after] = await listPollResults(org.id, resident.id);
    expect(after.isOpen).toBe(false);
  });

  it('scopes polls, votes and closing to the caller org', async () => {
    const { pollId, poll, resident } = await seedPollScenario();
    const otherOrg = await seedOrg(smoke.db, { name: 'Other Org' });

    expect(await listPollResults(otherOrg.id, resident.id)).toEqual([]);
    expect(await closePoll(otherOrg.id, pollId)).toBe(false);
    expect(await castVote({ orgId: otherOrg.id, pollId, optionId: poll.options[0].id, profileId: resident.id })).toBe('not_found');
  });

  it('rejects an option that belongs to another poll', async () => {
    const { org, admin, resident, pollId } = await seedPollScenario();
    await insertPoll({ orgId: org.id, createdBy: admin.id, question: 'Second?', options: ['A', 'B'], closesAt: null });
    const results = await listPollResults(org.id, resident.id);
    const foreignOption = results.find((p) => p.id !== pollId)!.options[0];
    expect(await castVote({ orgId: org.id, pollId, optionId: foreignOption.id, profileId: resident.id })).toBe('not_found');
  });
});
