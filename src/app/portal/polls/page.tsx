import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { listPollResults } from '@/lib/polls/queries';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PollResults } from '@/components/polls/PollResults';
import { VoteForm } from './VoteForm';

export default async function PortalPollsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }
  const t = await getTranslations('polls');
  const polls = await listPollResults(ctx.orgId, ctx.userId);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>

      {polls.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyPortalDesc')} />
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => (
            <Card key={poll.id} padding="md">
              <h2 className="font-medium text-slate-900">{poll.question}</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                {poll.isOpen ? t('open') : t('closed')}
                {poll.closesAt && poll.isOpen && ` · ${t('closesOn', { date: poll.closesAt.toISOString().slice(0, 10) })}`}
              </p>
              {poll.isOpen && !poll.viewerOptionId ? (
                <VoteForm pollId={poll.id} options={poll.options} />
              ) : (
                <PollResults poll={poll} votesLabel={t('votes')} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
