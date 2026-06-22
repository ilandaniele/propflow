import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { incidents, incidentComments, profiles, tenants } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
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

  const t = await getTranslations('incidentDetail');

  // Alias profiles twice — once for createdBy, once for assignedTo
  const createdByProfiles = profiles;

  const [incidentRows, commentRows, adminRows] = await Promise.all([
    db
      .select({
        id:          incidents.id,
        orgId:       incidents.orgId,
        title:       incidents.title,
        description: incidents.description,
        category:    incidents.category,
        priority:    incidents.priority,
        status:      incidents.status,
        tenantId:    incidents.tenantId,
        unitId:      incidents.unitId,
        propertyId:  incidents.propertyId,
        createdBy:   incidents.createdBy,
        assignedTo:  incidents.assignedTo,
        resolvedAt:  incidents.resolvedAt,
        cost:        incidents.cost,
        createdAt:   incidents.createdAt,
        updatedAt:   incidents.updatedAt,
        photoPath:   incidents.photoPath,
        creatorName: createdByProfiles.fullName,
      })
      .from(incidents)
      .leftJoin(createdByProfiles, eq(createdByProfiles.id, incidents.createdBy))
      .where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId))),
    db
      .select({
        id:         incidentComments.id,
        body:       incidentComments.body,
        createdAt:  incidentComments.createdAt,
        authorId:   incidentComments.authorId,
        authorName: profiles.fullName,
      })
      .from(incidentComments)
      .leftJoin(profiles, eq(profiles.id, incidentComments.authorId))
      .where(and(eq(incidentComments.incidentId, id), eq(incidentComments.orgId, ctx.orgId)))
      .orderBy(asc(incidentComments.createdAt)),
    db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.orgId, ctx.orgId), eq(profiles.role, 'admin'))),
  ]);

  if (!incidentRows.length) notFound();
  const incident = incidentRows[0];

  // Shape to legacy snake_case Incident type for UpdateIncidentForm
  const incidentForForm = {
    id:          incident.id,
    org_id:      incident.orgId,
    title:       incident.title,
    description: incident.description,
    category:    incident.category,
    priority:    incident.priority,
    status:      incident.status,
    tenant_id:   incident.tenantId,
    unit_id:     incident.unitId,
    property_id: incident.propertyId,
    created_by:  incident.createdBy,
    assigned_to: incident.assignedTo,
    resolved_at: incident.resolvedAt ? String(incident.resolvedAt) : null,
    cost:        incident.cost,
    created_at:  incident.createdAt ? String(incident.createdAt) : '',
    updated_at:  incident.updatedAt ? String(incident.updatedAt) : '',
    photo_path:  incident.photoPath,
    airtable_external_id: null,
    airtable_synced_at: null,
  };

  const adminsForForm = adminRows.map((a) => ({ id: a.id, full_name: a.fullName ?? null }));

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
          {t('reportedBy')} {incident.creatorName ?? t('unknown')} {t('on')} {incident.createdAt ? new Date(incident.createdAt).toLocaleDateString() : '—'}
          {incident.resolvedAt && ` · ${t('resolved')} ${new Date(incident.resolvedAt).toLocaleDateString()}`}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="sm:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>{t('cardDescription')}</CardTitle></CardHeader>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.description}</p>
          </Card>

          {/* Timeline / Comments */}
          <Card>
            <CardHeader><CardTitle>{t('cardTimeline')}</CardTitle></CardHeader>
            {commentRows.length === 0 ? (
              <p className="text-sm text-slate-400">{t('noComments')}</p>
            ) : (
              <div className="space-y-4">
                {commentRows.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <Avatar name={comment.authorName ?? undefined} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-slate-900">{comment.authorName ?? t('unknown')}</p>
                        <p className="text-xs text-slate-400">{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : '—'}</p>
                      </div>
                      <p className="text-sm text-slate-700">{comment.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <CommentForm incidentId={incident.id} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{t('cardManage')}</CardTitle></CardHeader>
            <UpdateIncidentForm incident={incidentForForm as never} admins={adminsForForm} />
          </Card>
        </div>
      </div>
    </div>
  );
}
