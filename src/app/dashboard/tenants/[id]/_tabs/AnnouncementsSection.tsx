import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPortalPreviewAnnouncements } from '@/lib/portal-preview/queries';

const BODY_PREVIEW_LENGTH = 80;

interface Props {
  unitId: string | null;
  propertyId: string | null;
  orgId: string;
}

/**
 * Async Server Component — read-only list of announcements visible to this tenant.
 * Mirrors the tenant audience logic: status=published, non-expired,
 * audience=all|unit|property matching tenant's unit/property (AC9).
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function AnnouncementsSection({ unitId, propertyId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');
  const supabase = await createClient();

  const announcements = await getPortalPreviewAnnouncements(
    supabase,
    unitId,
    propertyId,
    ctx.orgId
  );

  const audienceLabel = (audience: 'all' | 'property' | 'unit') => {
    if (audience === 'all') return t('portalPreview.announcements.audienceAll');
    if (audience === 'unit') return t('portalPreview.announcements.audienceUnit');
    return t('portalPreview.announcements.audienceProperty');
  };

  const audienceBadgeClass = (audience: 'all' | 'property' | 'unit') => {
    if (audience === 'all') return 'bg-green-50 text-green-700';
    if (audience === 'unit') return 'bg-blue-50 text-blue-700';
    return 'bg-purple-50 text-purple-700';
  };

  return (
    <Card data-testid="portal-preview-announcements">
      <CardHeader>
        <CardTitle>{t('portalPreview.sections.announcements')}</CardTitle>
      </CardHeader>
      {announcements.length === 0 ? (
        <p className="text-sm text-slate-400">{t('portalPreview.announcements.empty')}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {announcements.map((a) => (
            <div key={a.id} className="py-3 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-slate-900 text-sm">{a.title}</p>
                <span
                  className={[
                    'shrink-0 text-xs font-medium px-2 py-0.5 rounded-full',
                    audienceBadgeClass(a.audience),
                  ].join(' ')}
                >
                  {audienceLabel(a.audience)}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {a.body.slice(0, BODY_PREVIEW_LENGTH)}{a.body.length > BODY_PREVIEW_LENGTH ? '…' : ''}
              </p>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                {a.published_at && (
                  <span>{new Date(a.published_at).toLocaleDateString()}</span>
                )}
                {a.expires_at && (
                  <span>
                    {t('portalPreview.announcements.expiresAt')}: {new Date(a.expires_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
