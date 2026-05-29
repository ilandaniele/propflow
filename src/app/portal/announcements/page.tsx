import { requireTenant } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';

export default async function PortalAnnouncementsPage() {
  await requireTenant();
  const supabase = await createClient();

  // RLS policy handles audience filtering automatically
  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, published_at, expires_at, audience')
    .order('published_at', { ascending: false })
    .limit(25);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Announcements</h1>

      {(announcements ?? []).length === 0 ? (
        <EmptyState title="No announcements" description="Announcements from your landlord will appear here." />
      ) : (
        <div className="space-y-3">
          {(announcements ?? []).map((ann) => (
            <Card key={ann.id} padding="md">
              <h2 className="font-medium text-slate-900">{ann.title}</h2>
              {/* Plain text rendering — no dangerouslySetInnerHTML (IC-E2) */}
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{ann.body}</p>
              <p className="mt-2 text-xs text-slate-400">
                {ann.published_at ? new Date(ann.published_at).toLocaleDateString() : ''}
                {ann.expires_at ? ` · Expires ${new Date(ann.expires_at).toLocaleDateString()}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
