import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { CommunityAdminClient } from './CommunityAdminClient';

export default async function AdminCommunityPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from('community_posts')
    .select('id, title, body, category, pinned, author_id, created_at')
    .eq('org_id', ctx.orgId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Community Board</h1>

      {(posts ?? []).length === 0 ? (
        <EmptyState title="No posts yet" description="Community posts from tenants will appear here." />
      ) : (
        <CommunityAdminClient posts={posts ?? []} />
      )}
    </div>
  );
}
