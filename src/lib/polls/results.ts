export interface PollResultRow {
  pollId: string;
  question: string;
  closesAt: Date | null;
  createdAt: Date;
  optionId: string;
  label: string;
  position: number;
  votes: number;
  votedByViewer: number;
}

export interface PollOptionResult {
  id: string;
  label: string;
  votes: number;
  percent: number;
}

export interface PollResult {
  id: string;
  question: string;
  closesAt: Date | null;
  createdAt: Date;
  isOpen: boolean;
  totalVotes: number;
  viewerOptionId: string | null;
  options: PollOptionResult[];
}

export function groupPollResults(rows: PollResultRow[], now: Date): PollResult[] {
  const byPoll = new Map<string, PollResult>();
  for (const row of rows) {
    let poll = byPoll.get(row.pollId);
    if (!poll) {
      poll = {
        id: row.pollId,
        question: row.question,
        closesAt: row.closesAt,
        createdAt: row.createdAt,
        isOpen: !row.closesAt || row.closesAt > now,
        totalVotes: 0,
        viewerOptionId: null,
        options: [],
      };
      byPoll.set(row.pollId, poll);
    }
    poll.totalVotes += row.votes;
    if (row.votedByViewer > 0) poll.viewerOptionId = row.optionId;
    poll.options.push({ id: row.optionId, label: row.label, votes: row.votes, percent: 0 });
  }
  const polls = [...byPoll.values()];
  for (const poll of polls) {
    for (const option of poll.options) {
      option.percent = poll.totalVotes === 0 ? 0 : Math.round((option.votes / poll.totalVotes) * 100);
    }
  }
  return polls;
}
