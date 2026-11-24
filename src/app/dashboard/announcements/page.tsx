import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { announcements, properties, units } from '@/lib/db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { AnnouncementForm } from './AnnouncementForm';
import { PinToggle } from './PinToggle';

export default async function AnnouncementsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('announcements');

  const [rows, propertyRows, unitRows] = await Promise.all([
    db
    .select({
      id:          announcements.id,
      title:       announcements.title,
      body:        announcements.body,
      audience:    announcements.audience,
      publishedAt: announcements.publishedAt,
      expiresAt:   announcements.expiresAt,
      createdAt:   announcements.createdAt,
      pinned:      announcements.pinned,
      important:   announcements.important,
    })
    .from(announcements)
    .where(eq(announcements.orgId, ctx.orgId))
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
    .limit(50),
    db.select({ id: properties.id, label: properties.name }).from(properties)
      .where(eq(properties.orgId, ctx.orgId)).orderBy(asc(properties.name)).limit(500),
    db.select({ id: units.id, label: units.label }).from(units)
      .where(eq(units.orgId, ctx.orgId)).orderBy(asc(units.label)).limit(1000),
  ]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newForm')}</h2>
        <AnnouncementForm properties={propertyRows} units={unitRows} />
      </Card>

      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="space-y-3">
          {rows.map((ann) => (
            <Card key={ann.id} padding="md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-slate-900">{ann.title}</h3>
                    {ann.pinned && <Badge variant="info">{t('pinned')}</Badge>}
                    {ann.important && <Badge variant="warning">{t('important')}</Badge>}
                  </div>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">{ann.body}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span>{t('audience')}: {ann.audience}</span>
                    {ann.expiresAt && <span>{t('expires')}: {new Date(ann.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <PinToggle id={ann.id} pinned={ann.pinned} />
                  <StatusPill status={ann.publishedAt ? 'published' : 'draft'} />
                </div>
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
