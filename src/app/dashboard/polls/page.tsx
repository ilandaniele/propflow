import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listPollResults } from '@/lib/polls/queries';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PollResults } from '@/components/polls/PollResults';
import { ClosePollForm, CreatePollForm } from './PollForms';

export const metadata: Metadata = { title: 'Encuestas' };

export default async function AdminPollsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('polls');
  const polls = await listPollResults(ctx.orgId, ctx.userId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('adminSubtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('createTitle')}</h2>
        <CreatePollForm />
      </Card>

      {polls.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyAdminDesc')} />
      ) : (
        <div className="space-y-4">
          {polls.map((poll) => (
            <Card key={poll.id} padding="md">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="font-medium text-slate-900">{poll.question}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {poll.isOpen ? t('open') : t('closed')} · {t('totalVotes', { count: poll.totalVotes })}
                    {poll.closesAt && ` · ${t('closesOn', { date: poll.closesAt.toISOString().slice(0, 10) })}`}
                  </p>
                </div>
                {poll.isOpen && <ClosePollForm pollId={poll.id} />}
              </div>
              <PollResults poll={poll} votesLabel={t('votes')} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
