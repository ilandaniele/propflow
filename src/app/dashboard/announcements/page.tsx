import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { AnnouncementForm } from './AnnouncementForm';

export default async function AnnouncementsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, audience, published_at, expires_at, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Announcements</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">New Announcement</h2>
        <AnnouncementForm />
      </Card>

      {(announcements ?? []).length === 0 ? (
        <EmptyState title="No announcements yet" description="Create and publish announcements to notify your tenants." />
      ) : (
        <div className="space-y-3">
          {(announcements ?? []).map((ann) => (
            <Card key={ann.id} padding="md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-slate-900">{ann.title}</h3>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">{ann.body}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span>Audience: {ann.audience}</span>
                    {ann.expires_at && <span>Expires: {new Date(ann.expires_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <StatusPill status={ann.published_at ? 'published' : 'draft'} />
              </div>
              {!ann.published_at && (
                <form className="mt-3" action={async (formData) => {
                  'use server';
                  const { publishAnnouncement } = await import('@/app/actions/ops');
                  await publishAnnouncement({}, formData);
                }}>
                  <input type="hidden" name="id" value={ann.id} />
                  <button type="submit" className="text-xs text-brand-600 hover:underline font-medium">
                    Publish now
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
