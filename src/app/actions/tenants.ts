'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreateTenantSchema, UpdateTenantSchema, AssignTenantToUnitSchema } from '@/lib/schemas/tenant';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { z } from 'zod';
import type { ActionResult } from '@/lib/errors';

// Phase 4 schemas for tenant profile additions
const UpdateTenantAvatarSchema = z.object({
  tenant_id: z.string().uuid(),
  photo_url: z.string().min(1).max(500),
});

const UpdateTenantPreferredLanguageSchema = z.object({
  tenant_id: z.string().uuid(),
  preferred_language: z.enum(['es', 'en', 'pt']),
});

const UpdateTenantWhatsappPhoneSchema = z.object({
  tenant_id: z.string().uuid(),
  whatsapp_phone: z.string().regex(/^\+\d{7,15}$/, 'E.164 format required').or(z.literal('')),
  whatsapp_opt_in: z.enum(['true', 'false']).optional(),
});

const AddInternalNoteSchema = z.object({
  tenant_id: z.string().uuid(),
  content: z.string().min(1).max(2000),
});

export async function createTenant(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateTenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { error } = await supabase.from('tenants').insert({
    ...parsed.data,
    org_id: ctx.orgId,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    notes: parsed.data.notes || null,
  });

  if (error) {
    log.error('[createTenant] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_tenant', 'tenant');
  revalidatePath('/dashboard/tenants');
  return ok(undefined);
}

export async function updateTenant(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateTenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('tenants')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenant] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant', 'tenant', id);
  revalidatePath('/dashboard/tenants');
  revalidatePath(`/dashboard/tenants/${id}`);
  return ok(undefined);
}

// ─── Phase 4: Tenant profile actions ─────────────────────────────────────────

/**
 * Update tenant avatar photo_url after upload to Supabase storage.
 * The caller uploads to the bucket first, then calls this action with the storage path.
 * Validates MIME and size constraints are enforced by the bucket policy (2MB, image only).
 */
export async function updateTenantAvatar(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update_tenant_avatar');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateTenantAvatarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { error } = await supabase
    .from('tenants')
    .update({ photo_url: parsed.data.photo_url, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenantAvatar] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant_avatar', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function updateTenantPreferredLanguage(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update_tenant_language');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateTenantPreferredLanguageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { error } = await supabase
    .from('tenants')
    .update({ preferred_language: parsed.data.preferred_language, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenantPreferredLanguage] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant_language', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function updateTenantWhatsappPhone(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update_tenant_whatsapp');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateTenantWhatsappPhoneSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { error } = await supabase
    .from('tenants')
    .update({
      whatsapp_phone: parsed.data.whatsapp_phone || null,
      whatsapp_opt_in: parsed.data.whatsapp_opt_in === 'true',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenantWhatsappPhone] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant_whatsapp', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function addInternalNote(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'add_internal_note');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AddInternalNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify tenant belongs to org
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) return Errors.NOT_FOUND();

  const { error } = await supabase
    .from('internal_notes')
    .insert({
      org_id: ctx.orgId,
      tenant_id: parsed.data.tenant_id,
      content: parsed.data.content,
      created_by: ctx.userId,
    });

  if (error) {
    log.error('[addInternalNote] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'add_internal_note', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function assignTenantToUnit(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = AssignTenantToUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify both tenant and unit belong to this org (RLS enforces, but explicit check for 404)
  const [tenantRes, unitRes] = await Promise.all([
    supabase.from('tenants').select('id').eq('id', parsed.data.tenant_id).eq('org_id', ctx.orgId).single(),
    supabase.from('units').select('id, status').eq('id', parsed.data.unit_id).eq('org_id', ctx.orgId).single(),
  ]);

  if (!tenantRes.data) return Errors.NOT_FOUND();
  if (!unitRes.data) return Errors.NOT_FOUND();

  // Update tenant's unit_id and flip unit to occupied
  const [tenantUpdate, unitUpdate] = await Promise.all([
    supabase.from('tenants').update({ unit_id: parsed.data.unit_id, updated_at: new Date().toISOString() }).eq('id', parsed.data.tenant_id),
    supabase.from('units').update({ status: 'occupied', updated_at: new Date().toISOString() }).eq('id', parsed.data.unit_id),
  ]);

  if (tenantUpdate.error || unitUpdate.error) {
    log.error('[assignTenantToUnit] db error', { tenantErr: tenantUpdate.error?.code, unitErr: unitUpdate.error?.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'assign_tenant_to_unit', 'tenant', parsed.data.tenant_id);
  revalidatePath('/dashboard/tenants');
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
