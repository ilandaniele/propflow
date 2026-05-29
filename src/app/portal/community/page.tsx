import { requireTenant } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { CommunityFeedClient } from './CommunityFeedClient';

export default async function PortalCommunityPage() {
  const ctx = await requireTenant();
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from('community_posts')
    .select('id, title, body, category, pinned, author_id, created_at')
    .eq('org_id', ctx.orgId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(25);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Community Board</h1>
      <CommunityFeedClient posts={posts ?? []} currentUserId={ctx.userId} />
    </div>
  );
}
