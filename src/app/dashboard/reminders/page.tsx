import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { reminders } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

export default async function RemindersPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('reminders');

  const rows = await db
    .select({
      id:             reminders.id,
      type:           reminders.type,
      targetType:     reminders.targetType,
      channel:        reminders.channel,
      scheduledFor:   reminders.scheduledFor,
      sentAt:         reminders.sentAt,
      status:         reminders.status,
      messagePreview: reminders.messagePreview,
    })
    .from(reminders)
    .where(eq(reminders.orgId, ctx.orgId))
    .orderBy(desc(reminders.scheduledFor))
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} padding="md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-slate-900 capitalize">{r.type.replace('_', ' ')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t('for')}: {r.targetType} · {t('channel')}: {r.channel} · {t('scheduled')}: {r.scheduledFor}</p>
                  {r.messagePreview && <p className="text-xs text-slate-600 mt-1 line-clamp-1">{r.messagePreview}</p>}
                </div>
                <StatusPill status={r.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
