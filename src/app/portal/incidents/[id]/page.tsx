import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { incidents, incidentComments, profiles } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
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

  const [incidentRows, commentRows] = await Promise.all([
    db.select({
      id: incidents.id,
      orgId: incidents.orgId,
      title: incidents.title,
      description: incidents.description,
      status: incidents.status,
      priority: incidents.priority,
      category: incidents.category,
      resolvedAt: incidents.resolvedAt,
      createdAt: incidents.createdAt,
      photoPath: incidents.photoPath,
    })
      .from(incidents)
      .where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId))),
    db.select({
      id: incidentComments.id,
      authorId: incidentComments.authorId,
      body: incidentComments.body,
      createdAt: incidentComments.createdAt,
    })
      .from(incidentComments)
      .where(and(eq(incidentComments.incidentId, id), eq(incidentComments.orgId, ctx.orgId)))
      .orderBy(asc(incidentComments.createdAt)),
  ]);

  const incident = incidentRows[0];
  if (!incident) notFound();

  // Load comment author names
  const authorIds = [...new Set(commentRows.map((c) => c.authorId))];
  const authorMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const authorRows = await db.select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.orgId, ctx.orgId));
    for (const a of authorRows) authorMap.set(a.id, a.fullName);
  }

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
          Reported {new Date(incident.createdAt).toLocaleDateString()} ·
          <span className="capitalize ml-1">{incident.category}</span>
          {incident.resolvedAt && ` · Resolved ${new Date(incident.resolvedAt).toLocaleDateString()}`}
        </p>
      </div>

      <Card>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.description}</p>
      </Card>

      {/* Comments */}
      <Card>
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Updates & Comments</h2>
        {commentRows.length === 0 ? (
          <p className="text-sm text-slate-400 mb-4">No updates yet. Your property manager will respond here.</p>
        ) : (
          <div className="space-y-4 mb-4">
            {commentRows.map((comment) => {
              const authorName = authorMap.get(comment.authorId) ?? null;
              return (
                <div key={comment.id} className="flex gap-3">
                  <Avatar name={authorName} size="sm" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs font-medium text-slate-900">{authorName ?? 'Team'}</p>
                      <p className="text-xs text-slate-400">{new Date(comment.createdAt).toLocaleString()}</p>
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
