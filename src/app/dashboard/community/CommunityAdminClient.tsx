'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { pinPost } from '@/app/actions/community';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface Post {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  author_id: string;
  created_at: string;
}

export function CommunityAdminClient({ posts }: { posts: Post[] }) {
  const t = useTranslations('community');
  const [isPending, startTransition] = useTransition();

  function handlePin(postId: string, currentlyPinned: boolean) {
    const formData = new FormData();
    formData.set('id', postId);
    formData.set('pinned', String(!currentlyPinned));
    startTransition(async () => { await pinPost({}, formData); });
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <div key={post.id} className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {post.pinned && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{t('pinned')}</span>
                )}
                <h3 className="text-sm font-medium text-slate-900">{post.title}</h3>
                <Badge variant="default">{post.category}</Badge>
              </div>
              {/* Plain text rendering — no dangerouslySetInnerHTML (IC-E2) */}
              <p className="text-sm text-slate-600 mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
              <p className="text-xs text-slate-400 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handlePin(post.id, post.pinned)}
              disabled={isPending}
            >
              {post.pinned ? t('unpin') : t('pin')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
