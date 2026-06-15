import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { incidents, incidentComments, profiles } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
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

  const [incidentRows, commentRows, adminRows] = await Promise.all([
    db.select({
      id: incidents.id,
      orgId: incidents.orgId,
      unitId: incidents.unitId,
      propertyId: incidents.propertyId,
      tenantId: incidents.tenantId,
      title: incidents.title,
      description: incidents.description,
      status: incidents.status,
      priority: incidents.priority,
      category: incidents.category,
      createdBy: incidents.createdBy,
      assignedTo: incidents.assignedTo,
      resolvedAt: incidents.resolvedAt,
      updatedAt: incidents.updatedAt,
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
    db.select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.orgId, ctx.orgId), eq(profiles.role, 'admin'))),
  ]);

  const incident = incidentRows[0];
  if (!incident) notFound();

  // Load reporter name
  let createdByName: string | null = null;
  if (incident.createdBy) {
    const reporter = await db.select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, incident.createdBy))
      .then((r) => r[0] ?? null);
    createdByName = reporter?.fullName ?? null;
  }

  // Load comment author names
  const authorIds = [...new Set(commentRows.map((c) => c.authorId))];
  const authorMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const authorRows = await db.select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.orgId, ctx.orgId));
    for (const a of authorRows) authorMap.set(a.id, a.fullName);
  }

  const admins = adminRows.map((a) => ({ id: a.id, full_name: a.fullName }));

  // Shape incident for existing form components
  const incidentForForm = {
    ...incident,
    resolved_at: incident.resolvedAt?.toISOString() ?? null,
    created_at: incident.createdAt.toISOString(),
    updated_at: incident.updatedAt?.toISOString() ?? incident.createdAt.toISOString(),
    assigned_to: incident.assignedTo,
    org_id: incident.orgId,
    photo_path: incident.photoPath,
    unit_id: incident.unitId ?? null,
    property_id: incident.propertyId ?? null,
    created_by: incident.createdBy,
    tenant_id: incident.tenantId ?? null,
  };

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
          Reported by {createdByName ?? 'Unknown'} on {new Date(incident.createdAt).toLocaleDateString()}
          {incident.resolvedAt && ` · Resolved ${new Date(incident.resolvedAt).toLocaleDateString()}`}
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
            {commentRows.length === 0 ? (
              <p className="text-sm text-slate-400">No comments yet</p>
            ) : (
              <div className="space-y-4">
                {commentRows.map((comment) => {
                  const authorName = authorMap.get(comment.authorId) ?? null;
                  return (
                    <div key={comment.id} className="flex gap-3">
                      <Avatar name={authorName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-slate-900">{authorName ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-400">{new Date(comment.createdAt).toLocaleString()}</p>
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
            <UpdateIncidentForm incident={incidentForForm as Parameters<typeof UpdateIncidentForm>[0]['incident']} admins={admins} />
          </Card>
        </div>
      </div>
    </div>
  );
}
