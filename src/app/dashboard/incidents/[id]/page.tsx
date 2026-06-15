import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { UpdateIncidentForm } from './UpdateIncidentForm';
import { CommentForm } from './CommentForm';

export const metadata: Metadata = { title: 'Incident Details' };

interface Props { params: Promise<{ id: string }> }

export default async function IncidentDetailPage({ params }: Props) {
  const { id } = await params;
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const [incidentRes, commentsRes, adminsRes] = await Promise.all([
    supabase.from('incidents').select('*, profiles!incidents_created_by_fkey(full_name), tenants(full_name)').eq('id', id).eq('org_id', ctx.orgId).single(),
    supabase.from('incident_comments').select('*, profiles!incident_comments_author_id_fkey(full_name)').eq('incident_id', id).eq('org_id', ctx.orgId).order('created_at', { ascending: true }),
    supabase.from('profiles').select('id, full_name').eq('org_id', ctx.orgId).eq('role', 'admin'),
  ]);

  if (!incidentRes.data) notFound();

  const incident = incidentRes.data;
  const comments = commentsRes.data ?? [];
  const admins = adminsRes.data ?? [];
  const createdBy = incident.profiles as { full_name: string | null } | null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <PriorityPill priority={incident.priority} />
          <StatusPill status={incident.status} />
          <span className="text-sm text-slate-400 capitalize">{incident.category}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{incident.title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Reported by {createdBy?.full_name ?? 'Unknown'} on {new Date(incident.created_at).toLocaleDateString()}
          {incident.resolved_at && ` · Resolved ${new Date(incident.resolved_at).toLocaleDateString()}`}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="sm:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Description</CardTitle></CardHeader>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.description}</p>
          </Card>

          {/* Timeline / Comments */}
          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            {comments.length === 0 ? (
              <p className="text-sm text-slate-400">No comments yet</p>
            ) : (
              <div className="space-y-4">
                {comments.map((comment) => {
                  const author = comment.profiles as { full_name: string | null } | null;
                  return (
                    <div key={comment.id} className="flex gap-3">
                      <Avatar name={author?.full_name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-slate-900">{author?.full_name ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-400">{new Date(comment.created_at).toLocaleString()}</p>
                        </div>
                        <p className="text-sm text-slate-700">{comment.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <CommentForm incidentId={incident.id} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Manage</CardTitle></CardHeader>
            <UpdateIncidentForm incident={incident} admins={admins} />
          </Card>
        </div>
      </div>
    </div>
  );
}
