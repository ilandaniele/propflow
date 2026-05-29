import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { PortalCommentForm } from './PortalCommentForm';

export const metadata: Metadata = { title: 'Incident Details' };

interface Props { params: Promise<{ id: string }> }

export default async function PortalIncidentDetailPage({ params }: Props) {
  const { id } = await params;
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const [incidentRes, commentsRes] = await Promise.all([
    supabase.from('incidents').select('*').eq('id', id).eq('org_id', ctx.orgId).single(),
    supabase.from('incident_comments').select('*, profiles!incident_comments_author_id_fkey(full_name)').eq('incident_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: true }),
  ]);

  if (!incidentRes.data) notFound();

  const incident = incidentRes.data;
  const comments = commentsRes.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/portal/incidents" className="text-sm text-slate-500 hover:text-slate-900">← Back</Link>
        <div className="flex items-center gap-2">
          <PriorityPill priority={incident.priority} />
          <StatusPill status={incident.status} />
        </div>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{incident.title}</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Reported {new Date(incident.created_at).toLocaleDateString()} ·
          <span className="capitalize ml-1">{incident.category}</span>
          {incident.resolved_at && ` · Resolved ${new Date(incident.resolved_at).toLocaleDateString()}`}
        </p>
      </div>

      <Card>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.description}</p>
      </Card>

      {/* Comments */}
      <Card>
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Updates & Comments</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-slate-400 mb-4">No updates yet. Your property manager will respond here.</p>
        ) : (
          <div className="space-y-4 mb-4">
            {comments.map((comment) => {
              const author = comment.profiles as { full_name: string | null } | null;
              return (
                <div key={comment.id} className="flex gap-3">
                  <Avatar name={author?.full_name} size="sm" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs font-medium text-slate-900">{author?.full_name ?? 'Team'}</p>
                      <p className="text-xs text-slate-400">{new Date(comment.created_at).toLocaleString()}</p>
                    </div>
                    <p className="text-sm text-slate-700">{comment.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <PortalCommentForm incidentId={incident.id} />
      </Card>
    </div>
  );
}
