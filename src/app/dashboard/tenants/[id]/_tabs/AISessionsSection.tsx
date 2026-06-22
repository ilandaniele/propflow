import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPortalPreviewAISessions } from '@/lib/portal-preview/queries';

interface Props {
  profileId: string | null;
  orgId: string;
}

/**
 * Async Server Component — read-only list of AI chat sessions for this tenant.
 * If profileId is null (no portal account linked), renders an empty-state note
 * without querying the DB (IC5). Uses the AC10-compliant helper which groups
 * ai_chat_messages by session_id via groupAISessions().
 *
 * Session expand uses <details>/<summary> (zero client JS, read-only).
 * No forms, buttons, or mutations. No reference to internal_notes.
 */
export async function AISessionsSection({ profileId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenants');

  // getPortalPreviewAISessions returns [] immediately when profileId is null (IC5)
  const sessions = await getPortalPreviewAISessions(profileId, ctx.orgId);

  return (
    <Card data-testid="portal-preview-ai-sessions">
      <CardHeader>
        <CardTitle>{t('portalPreview.sections.aiSessions')}</CardTitle>
      </CardHeader>

      {profileId === null ? (
        <p className="text-sm text-slate-400 italic">{t('portalPreview.aiSessions.noAccount')}</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-400">{t('portalPreview.aiSessions.empty')}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {sessions.map((s) => (
            <div key={s.session_id} className="py-3">
              <div className="flex items-center justify-between text-sm">
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-500">
                    {t('portalPreview.aiSessions.startedAt')}: {new Date(s.started_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('portalPreview.aiSessions.messages')}: {s.message_count}
                  </p>
                </div>
              </div>
              {s.last_user_preview && (
                <p className="mt-1 text-xs text-slate-400 italic truncate">
                  {t('portalPreview.aiSessions.lastMessage')}: &ldquo;{s.last_user_preview}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
