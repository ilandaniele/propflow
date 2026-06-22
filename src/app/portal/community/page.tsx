import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { communityPosts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { CommunityFeedClient } from './CommunityFeedClient';

export default async function PortalCommunityPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const posts = await db
    .select({
      id:        communityPosts.id,
      title:     communityPosts.title,
      body:      communityPosts.body,
      category:  communityPosts.category,
      pinned:    communityPosts.pinned,
      author_id: communityPosts.authorId,
      created_at: communityPosts.createdAt,
    })
    .from(communityPosts)
    .where(eq(communityPosts.orgId, ctx.orgId))
    .orderBy(desc(communityPosts.pinned), desc(communityPosts.createdAt))
    .limit(25);

  // Map to snake_case shape expected by CommunityFeedClient
  const postsForClient = posts.map((p) => ({
    id:         p.id,
    title:      p.title,
    body:       p.body,
    category:   p.category,
    pinned:     p.pinned,
    author_id:  p.author_id,
    created_at: p.created_at ? String(p.created_at) : '',
  }));

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Community Board</h1>
      <CommunityFeedClient posts={postsForClient as never} currentUserId={ctx.userId} />
    </div>
  );
}
