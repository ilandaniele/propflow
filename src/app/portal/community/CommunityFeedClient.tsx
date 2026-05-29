'use client';

import { useState, useTransition } from 'react';
import { createCommunityPost, addCommunityComment } from '@/app/actions/community';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface Post {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  author_id: string;
  created_at: string;
}

interface Props {
  posts: Post[];
  currentUserId?: string; // available for future use (e.g. highlighting own posts)
}

export function CommunityFeedClient({ posts }: Props) {
  const [showNewPost, setShowNewPost] = useState(false);
  const [commentingPostId, setCommentingPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleNewPost() {
    if (!title.trim() || !body.trim()) return;
    const formData = new FormData();
    formData.set('title', title.trim());
    formData.set('body', body.trim());
    formData.set('category', 'general');
    startTransition(async () => {
      const result = await createCommunityPost({}, formData);
      if (result.error) { setError(result.error.message); return; }
      setShowNewPost(false); setTitle(''); setBody(''); setError('');
    });
  }

  function handleComment(postId: string) {
    if (!commentText.trim()) return;
    const formData = new FormData();
    formData.set('post_id', postId);
    formData.set('body', commentText.trim());
    startTransition(async () => {
      const result = await addCommunityComment({}, formData);
      if (result.error) { setError(result.error.message); return; }
      setCommentingPostId(null); setCommentText(''); setError('');
    });
  }

  return (
    <div className="space-y-4">
      {/* New post button */}
      {!showNewPost ? (
        <Button onClick={() => setShowNewPost(true)} size="sm">New Post</Button>
      ) : (
        <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
          <h2 className="text-sm font-medium text-slate-900">New Post</h2>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Post title"
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What would you like to share?"
            rows={4}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Post body"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleNewPost} disabled={isPending}>
              {isPending ? 'Posting…' : 'Post'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNewPost(false)}>Cancel</Button>
          </div>
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
      )}

      {posts.length === 0 ? (
        <EmptyState title="No posts yet" description="Be the first to post in the community board." />
      ) : (
        posts.map((post) => (
          <div key={post.id} className="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
            <div className="flex items-start gap-2">
              {post.pinned && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">Pinned</span>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-slate-900">{post.title}</h3>
                {/* Plain text rendering — no dangerouslySetInnerHTML (LLM02/IC-E2) */}
                <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{post.body}</p>
                <p className="text-xs text-slate-400 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Comment section */}
            {commentingPostId === post.id ? (
              <div className="pt-2 space-y-2">
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Your comment…"
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  aria-label="Comment text"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleComment(post.id)} disabled={isPending}>
                    {isPending ? '…' : 'Comment'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCommentingPostId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCommentingPostId(post.id)}
                className="text-xs text-brand-600 hover:underline"
              >
                Reply
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
