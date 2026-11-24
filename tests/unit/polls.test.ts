import { describe, it, expect } from 'vitest';
import { CreatePollSchema, endOfDay } from '@/lib/polls/schemas';
import { groupPollResults, type PollResultRow } from '@/lib/polls/results';

describe('CreatePollSchema', () => {
  it('splits, trims and de-duplicates option lines', () => {
    const parsed = CreatePollSchema.parse({ question: ' Paint the lobby? ', options: 'Yes\r\n  No \n\nYes', closes_on: '' });
    expect(parsed).toEqual({ question: 'Paint the lobby?', options: ['Yes', 'No'], closes_on: undefined });
  });

  it('rejects fewer than 2 or more than 8 options', () => {
    expect(CreatePollSchema.safeParse({ question: 'Paint?', options: 'Only one' }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => `Option ${i}`).join('\n');
    expect(CreatePollSchema.safeParse({ question: 'Paint?', options: nine }).success).toBe(false);
  });

  it('rejects a malformed closing date', () => {
    expect(CreatePollSchema.safeParse({ question: 'Paint?', options: 'A\nB', closes_on: '12/31/2026' }).success).toBe(false);
    expect(CreatePollSchema.parse({ question: 'Paint?', options: 'A\nB', closes_on: '2026-12-31' }).closes_on).toBe('2026-12-31');
  });

  it('endOfDay returns the last millisecond of the UTC day', () => {
    expect(endOfDay('2026-12-31').toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
});

describe('groupPollResults', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const base = { question: 'Q', createdAt: now, closesAt: null, votedByViewer: 0 };

  function row(overrides: Partial<PollResultRow>): PollResultRow {
    return { ...base, pollId: 'p1', optionId: 'o1', label: 'A', position: 0, votes: 0, ...overrides };
  }

  it('groups options per poll with percentages and the viewer vote', () => {
    const [poll] = groupPollResults([
      row({ optionId: 'o1', label: 'A', votes: 1 }),
      row({ optionId: 'o2', label: 'B', position: 1, votes: 2, votedByViewer: 1 }),
    ], now);
    expect(poll.totalVotes).toBe(3);
    expect(poll.viewerOptionId).toBe('o2');
    expect(poll.options.map((o) => o.percent)).toEqual([33, 67]);
  });

  it('reports 0% without votes and closed when past closesAt', () => {
    const [poll] = groupPollResults([row({ closesAt: new Date('2026-11-01T00:00:00Z') })], now);
    expect(poll.isOpen).toBe(false);
    expect(poll.options[0].percent).toBe(0);
  });

  it('keeps polls separate', () => {
    expect(groupPollResults([row({ pollId: 'p1' }), row({ pollId: 'p2', optionId: 'o9' })], now)).toHaveLength(2);
  });
});
