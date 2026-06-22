import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { communityPosts } from '@/lib/db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { CommunityAdminClient } from './CommunityAdminClient';

export default async function AdminCommunityPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('community');

  const posts = await db
    .select({
      id:        communityPosts.id,
      title:     communityPosts.title,
      body:      communityPosts.body,
      category:  communityPosts.category,
      pinned:    communityPosts.pinned,
      authorId:  communityPosts.authorId,
      createdAt: communityPosts.createdAt,
    })
    .from(communityPosts)
    .where(eq(communityPosts.orgId, ctx.orgId))
    .orderBy(desc(communityPosts.pinned), desc(communityPosts.createdAt))
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      {posts.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <CommunityAdminClient posts={posts} />
      )}
    </div>
  );
}
