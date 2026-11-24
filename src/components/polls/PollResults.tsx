import type { PollResult } from '@/lib/polls/results';

export function PollResults({ poll, votesLabel }: { poll: PollResult; votesLabel: string }) {
  return (
    <ul className="space-y-2">
      {poll.options.map((option) => (
        <li key={option.id}>
          <div className="flex justify-between text-sm">
            <span className={option.id === poll.viewerOptionId ? 'font-medium text-brand-700' : 'text-slate-700'}>{option.label}</span>
            <span className="tabular-nums text-slate-500">{option.percent}% · {option.votes} {votesLabel}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${option.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
