import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { announcements } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { AnnouncementForm } from './AnnouncementForm';

export default async function AnnouncementsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('announcements');

  const rows = await db
    .select({
      id:          announcements.id,
      title:       announcements.title,
      body:        announcements.body,
      audience:    announcements.audience,
      publishedAt: announcements.publishedAt,
      expiresAt:   announcements.expiresAt,
      createdAt:   announcements.createdAt,
    })
    .from(announcements)
    .where(eq(announcements.orgId, ctx.orgId))
    .orderBy(desc(announcements.createdAt))
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newForm')}</h2>
        <AnnouncementForm />
      </Card>

      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="space-y-3">
          {rows.map((ann) => (
            <Card key={ann.id} padding="md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-slate-900">{ann.title}</h3>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">{ann.body}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span>{t('audience')}: {ann.audience}</span>
                    {ann.expiresAt && <span>{t('expires')}: {new Date(ann.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <StatusPill status={ann.publishedAt ? 'published' : 'draft'} />
              </div>
              {!ann.publishedAt && (
                <form className="mt-3" action={async (formData) => {
                  'use server';
                  const { publishAnnouncement } = await import('@/app/actions/ops');
                  await publishAnnouncement({}, formData);
                }}>
                  <input type="hidden" name="id" value={ann.id} />
                  <button type="submit" className="text-xs text-brand-600 hover:underline font-medium">
                    {t('publishNow')}
                  </button>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
