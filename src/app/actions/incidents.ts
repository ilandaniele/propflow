'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { incidents, incidentComments, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import {
  CreateIncidentSchema,
  UpdateIncidentSchema,
  AddCommentSchema,
  PhotoUploadSchema,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
} from '@/lib/schemas/incident';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { randomUUID } from 'crypto';

export async function createIncident(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateIncidentSchema.safeParse(Object.fromEntries(
    [...formData.entries()].filter(([, v]) => typeof v === 'string')
  ));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Validate photo BEFORE DB insert to fail fast on bad input.
  const photoFile = formData.get('photo') as File | null;
  const hasPhoto = photoFile != null && photoFile.size > 0;
  if (hasPhoto) {
    const photoValidation = PhotoUploadSchema.safeParse({
      fileName: photoFile.name,
      mimeType: photoFile.type,
      sizeBytes: photoFile.size,
    });
    if (!photoValidation.success) {
      return Errors.VALIDATION_ERROR(photoValidation.error.flatten());
    }
    if (!ALLOWED_MIME_TYPES.includes(photoFile.type as typeof ALLOWED_MIME_TYPES[number])) {
      return Errors.VALIDATION_ERROR({ formErrors: ['Only PNG, JPEG, and WebP images are allowed'], fieldErrors: {} });
    }
    if (photoFile.size > MAX_FILE_SIZE_BYTES) {
      return Errors.VALIDATION_ERROR({ formErrors: ['File must be under 5 MB'], fieldErrors: {} });
    }
  }

  // B4: For tenant callers always derive tenant_id server-side from DB
  let tenantId: string | null;
  if (ctx.role === 'tenant') {
    const tenantRow = await db.select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
      .then(r => r[0] ?? null);
    tenantId = tenantRow?.id ?? null;
  } else {
    tenantId = parsed.data.tenant_id || null;
  }

  // Insert incident row first — DB generates the real UUID.
  let newIncidentId: string;
  try {
    const [newIncident] = await db.insert(incidents).values({
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      tenantId: tenantId || null,
      unitId: parsed.data.unit_id || null,
      propertyId: parsed.data.property_id || null,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      status: 'pending',
      photoPath: null,
    }).returning({ id: incidents.id });
    newIncidentId = newIncident.id;
  } catch (err) {
    log.error('[createIncident] db insert error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  // Upload photo now that the incident row exists in the DB.
  if (hasPhoto && photoFile) {
    const ext = photoFile.name.split('.').pop() ?? 'jpg';
    const storagePath = `${ctx.orgId}/${newIncidentId}/${randomUUID()}.${ext}`;

    const photoBuffer = await photoFile.arrayBuffer();
    // Storage-only Supabase client for file upload
    const { createStorageClient } = await import('@/lib/supabase/server');
    const storageClient = await createStorageClient();
    const { error: uploadError } = await storageClient.storage
      .from('incident-photos')
      .upload(storagePath, photoBuffer, {
        contentType: photoFile.type,
        upsert: false,
      });

    if (uploadError) {
      log.error('[createIncident] photo upload error', { code: uploadError.message });
      revalidatePath('/dashboard/incidents');
      revalidatePath('/portal/incidents');
      return ok(undefined);
    }

    // Update the incident row with the actual storage path
    try {
      await db
        .update(incidents)
        .set({ photoPath: storagePath })
        .where(and(eq(incidents.id, newIncidentId), eq(incidents.orgId, ctx.orgId)));
    } catch (err) {
      log.error('[createIncident] photo_path update error', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  revalidatePath('/dashboard/incidents');
  revalidatePath('/portal/incidents');
  return ok(undefined);
}

export async function updateIncident(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateIncidentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;

  // Verify incident belongs to this org
  const existing = await db.select({ id: incidents.id, status: incidents.status })
    .from(incidents)
    .where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!existing) return Errors.NOT_FOUND();

  const updateData: Record<string, unknown> = {
    ...updates,
    assignedTo: updates.assigned_to || null,
    updatedAt: new Date(),
  };

  if (updates.status === 'solved' && existing.status !== 'solved') {
    updateData.resolvedAt = new Date();
  }

  try {
    await db
      .update(incidents)
      .set(updateData)
      .where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateIncident] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_incident', 'incident', id);
  revalidatePath('/dashboard/incidents');
  revalidatePath(`/dashboard/incidents/${id}`);
  return ok(undefined);
}

export async function addIncidentComment(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = AddCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify incident is accessible (org-scoped)
  const incident = await db.select({ id: incidents.id, orgId: incidents.orgId })
    .from(incidents)
    .where(and(eq(incidents.id, parsed.data.incident_id), eq(incidents.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!incident) return Errors.NOT_FOUND();

  try {
    await db.insert(incidentComments).values({
      orgId: ctx.orgId,
      incidentId: parsed.data.incident_id,
      authorId: ctx.userId,
      body: parsed.data.body,
    });
  } catch (err) {
    log.error('[addIncidentComment] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath(`/dashboard/incidents/${parsed.data.incident_id}`);
  revalidatePath(`/portal/incidents/${parsed.data.incident_id}`);
  return ok(undefined);
}
