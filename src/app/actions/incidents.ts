'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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

  const supabase = await createClient();

  // Validate photo BEFORE DB insert to fail fast on bad input.
  // The actual upload happens AFTER insert so the incident UUID exists in the DB
  // and the storage RLS ownership check (segment 2 = real incident id) passes.
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

  // B4: For tenant callers always derive tenant_id server-side from DB,
  // IGNORING any client-supplied tenant_id to prevent tenant impersonation.
  // For admin callers, use the validated client-supplied value.
  let tenantId: string | null;
  if (ctx.role === 'tenant') {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('id')
      .eq('profile_id', ctx.userId)
      .eq('org_id', ctx.orgId)
      .single();
    tenantId = tenantRow?.id ?? null;
  } else {
    tenantId = parsed.data.tenant_id || null;
  }

  // Insert incident row first — DB generates the real UUID.
  // photo_path is set to null initially; updated below if a photo was provided.
  const { data: newIncident, error: insertError } = await supabase
    .from('incidents')
    .insert({
      org_id: ctx.orgId,
      created_by: ctx.userId,
      tenant_id: tenantId || null,
      unit_id: parsed.data.unit_id || null,
      property_id: parsed.data.property_id || null,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      status: 'pending',
      photo_path: null,
    })
    .select('id')
    .single();

  if (insertError || !newIncident) {
    log.error('[createIncident] db insert error', { code: insertError?.code });
    return Errors.INTERNAL();
  }

  // Upload photo now that the incident row exists in the DB.
  // The storage RLS policy (migration 005) verifies path segment 2 against incidents.id,
  // so the upload MUST happen after the row is committed.
  if (hasPhoto && photoFile) {
    const ext = photoFile.name.split('.').pop() ?? 'jpg';
    const storagePath = `${ctx.orgId}/${newIncident.id}/${randomUUID()}.${ext}`;

    const photoBuffer = await photoFile.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('incident-photos')
      .upload(storagePath, photoBuffer, {
        contentType: photoFile.type,
        upsert: false,
      });

    if (uploadError) {
      log.error('[createIncident] photo upload error', { code: uploadError.message });
      // Incident row already created — clean up or leave without photo.
      // We leave the row intact (it is valid without a photo) but do not fail silently.
      // Returning INTERNAL here would leave an orphaned row; instead, return partial success
      // and let the admin re-attach if needed. For MVP, log and continue without photo.
      revalidatePath('/dashboard/incidents');
      revalidatePath('/portal/incidents');
      return ok(undefined);
    }

    // Update the incident row with the actual storage path
    const { error: updateError } = await supabase
      .from('incidents')
      .update({ photo_path: storagePath })
      .eq('id', newIncident.id)
      .eq('org_id', ctx.orgId);

    if (updateError) {
      log.error('[createIncident] photo_path update error', { code: updateError.code });
      // Non-fatal: incident exists without photo, which is acceptable.
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
  const supabase = await createClient();

  // Verify incident belongs to this org
  const { data: existing } = await supabase
    .from('incidents')
    .select('id, status')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!existing) return Errors.NOT_FOUND();

  const updateData: Record<string, unknown> = {
    ...updates,
    assigned_to: updates.assigned_to || null,
    updated_at: new Date().toISOString(),
  };

  if (updates.status === 'solved' && existing.status !== 'solved') {
    updateData.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('incidents')
    .update(updateData)
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateIncident] db error', { code: error.code });
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

  const supabase = await createClient();

  // Verify incident is accessible (RLS will also enforce)
  const { data: incident } = await supabase
    .from('incidents')
    .select('id, org_id')
    .eq('id', parsed.data.incident_id)
    .single();

  if (!incident) return Errors.NOT_FOUND();

  const { error } = await supabase.from('incident_comments').insert({
    org_id: ctx.orgId,
    incident_id: parsed.data.incident_id,
    author_id: ctx.userId,
    body: parsed.data.body,
  });

  if (error) {
    log.error('[addIncidentComment] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath(`/dashboard/incidents/${parsed.data.incident_id}`);
  revalidatePath(`/portal/incidents/${parsed.data.incident_id}`);
  return ok(undefined);
}
