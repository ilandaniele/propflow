'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreateTenantSchema, UpdateTenantSchema, AssignTenantToUnitSchema } from '@/lib/schemas/tenant';
import { LinkTenantPortalAccountSchema, SearchAuthUserByEmailSchema } from '@/lib/schemas/tenants';
import { mutationRateLimit, actionRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { z } from 'zod';
import type { ActionResult } from '@/lib/errors';
import {
  validateImageFile,
  buildStoragePath,
  uploadImage,
  deleteImage,
} from '@/lib/storage/index';

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

// ─── Tenant Portal Account Linking ───────────────────────────────────────────

/**
 * Search auth.users by email address (case-insensitive).
 *
 * Uses the admin client to bypass RLS for the auth.users lookup.
 * Returns matched auth users by querying the profiles table (which stores email).
 * Admin-only guard applied at the start.
 *
 * Security: only the admin-scoped Supabase admin client is used for cross-user
 * lookups. The result is filtered to the org to prevent data leakage.
 */
export async function searchAuthUserByEmail(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<{ matches: Array<{ profileId: string; email: string; fullName: string | null }> }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'search_auth_user');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SearchAuthUserByEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const adminClient = createAdminClient();

  // Search auth.users via the Supabase admin auth API (bypasses RLS).
  // We look up by email in the auth.users table — then cross-reference with
  // profiles to get the full_name if available.
  const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 50,
  });

  if (authError) {
    log.error('[searchAuthUserByEmail] auth.admin.listUsers error', { code: authError.status });
    return Errors.INTERNAL();
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const matchingUsers = (authUsers?.users ?? []).filter(
    (u) => u.email?.toLowerCase() === normalizedEmail
  );

  if (matchingUsers.length === 0) {
    return ok({ matches: [] });
  }

  // Fetch profiles for matched users (admin client — bypasses RLS)
  const matchedIds = matchingUsers.map((u) => u.id);
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name, email')
    .in('id', matchedIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const matches = matchingUsers.map((u) => {
    const profile = profileMap.get(u.id);
    return {
      profileId: u.id,
      email: u.email ?? '',
      fullName: profile?.full_name ?? null,
    };
  });

  return ok({ matches });
}

/**
 * Link a tenant row to a portal account (auth user profile).
 *
 * Security guarantees:
 * 1. requireAdmin() — caller must be an authenticated admin.
 * 2. mutationRateLimit — prevents brute-force linking.
 * 3. Zod validation on tenantId (uuid) and profileEmail (email).
 * 4. IDOR guard: tenant must belong to ctx.orgId before any write.
 * 5. Uses admin client ONLY for auth.users lookup and profiles insert.
 *    The tenants UPDATE uses the user-scoped RLS client (ctx.orgId enforced).
 * 6. Audit log row written to notification_inbox.
 *
 * Flow:
 * a. Find the auth user by email via admin client.
 * b. Find or create a profiles row for that user (role='tenant', org_id=tenant.org_id).
 * c. Set tenants.profile_id = profile.id.
 * d. Write audit log.
 */
export async function linkTenantPortalAccount(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<{ profileId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'link_tenant_portal_account');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = LinkTenantPortalAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { tenantId, profileEmail } = parsed.data;

  // Step 1: Verify the tenant belongs to admin's org (IDOR guard)
  const supabase = await createClient();
  const { data: tenant, error: tenantFetchError } = await supabase
    .from('tenants')
    .select('id, org_id, email, profile_id')
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId)
    .single();

  if (tenantFetchError || !tenant) {
    log.warn('[linkTenantPortalAccount] tenant not found or wrong org', { tenantId, orgId: ctx.orgId });
    return Errors.NOT_FOUND();
  }

  if (tenant.profile_id) {
    return Errors.CONFLICT('Tenant already has a linked portal account');
  }

  // Step 2: Find the auth user by email (admin client — reads across all users)
  const adminClient = createAdminClient();
  const { data: authUsersData, error: authListError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authListError) {
    log.error('[linkTenantPortalAccount] listUsers error', { code: authListError.status });
    return Errors.INTERNAL();
  }

  const normalizedEmail = profileEmail.toLowerCase();
  const matchedUser = (authUsersData?.users ?? []).find(
    (u) => u.email?.toLowerCase() === normalizedEmail
  );

  if (!matchedUser) {
    return Errors.NOT_FOUND();
  }

  const authUserId = matchedUser.id;

  // Step 3: Find or create a profiles row for this auth user
  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('id, role, org_id')
    .eq('id', authUserId)
    .maybeSingle();

  let profileId = authUserId;

  if (!existingProfile) {
    // Create a new tenant profile
    const { error: profileInsertError } = await adminClient
      .from('profiles')
      .insert({
        id: authUserId,
        org_id: ctx.orgId,
        role: 'tenant' as const,
        full_name: matchedUser.user_metadata?.full_name ?? null,
        email: matchedUser.email ?? profileEmail,
      });

    if (profileInsertError) {
      log.error('[linkTenantPortalAccount] profile insert error', { code: profileInsertError.code });
      return Errors.INTERNAL();
    }

    log.info('[linkTenantPortalAccount] created tenant profile', {
      event: 'tenant_profile_created',
      authUserId,
      orgId: ctx.orgId,
    });
  } else {
    // Profile exists — check role compatibility (must be tenant or not yet assigned)
    if (existingProfile.role !== 'tenant') {
      log.warn('[linkTenantPortalAccount] profile role mismatch', {
        authUserId,
        existingRole: existingProfile.role,
      });
      return Errors.CONFLICT('The matched user already has an admin account in a different role');
    }
    profileId = existingProfile.id;
  }

  // Step 4: Set tenants.profile_id (RLS client — restricted to org_id)
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ profile_id: profileId, updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId);

  if (updateError) {
    log.error('[linkTenantPortalAccount] tenants update error', { code: updateError.code });
    return Errors.INTERNAL();
  }

  // Step 5: Audit log (notification_inbox pattern — existing convention)
  await supabase.from('notification_inbox').insert({
    org_id: ctx.orgId,
    profile_id: ctx.userId,
    type: 'system',
    title: 'Tenant portal account linked',
    body: `Admin linked tenant ${tenantId} to portal account ${profileEmail}`,
    read_at: null,
  });

  log.adminAction(ctx.userId, 'link_tenant_portal_account', 'tenant', tenantId);
  revalidatePath(`/dashboard/tenants/${tenantId}`);
  revalidatePath('/dashboard/tenants');

  return ok({ profileId });
}

// ─── W3: Tenant self-service avatar ──────────────────────────────────────────

const TENANT_AVATAR_BUCKET = 'tenant-avatars';
const ONE_MINUTE_MS_TENANT = 60_000;

/** 5 requests / minute / tenant for avatar uploads (stricter — public-facing) */
function tenantAvatarRateLimit(userId: string) {
  return actionRateLimit(`tenant-avatar:upload:${userId}`, 5, ONE_MINUTE_MS_TENANT);
}

/**
 * Tenant self-service: upload own avatar.
 *
 * Security guarantees:
 * 1. requireTenant() — caller must be an authenticated tenant.
 * 2. Rate limit: 5/min per tenant (stricter than admin path).
 * 3. IDOR guard: looks up tenant row by profile_id = ctx.userId — tenant can only
 *    update their own row. No client-supplied tenant_id accepted.
 * 4. validateImageFile() — MIME allowlist + magic-byte sniff + 5 MB cap.
 * 5. Storage path built server-side ({orgId}/{tenantId}/{uuid}.{ext}) — no user filename.
 * 6. Old avatar deleted from storage before writing new one (no orphaned objects).
 *
 * Returns { ok: true } on success.
 */
export async function updateOwnTenantAvatar(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  // 1. Auth — tenant role required
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  // 2. Rate limit (5/min per tenant)
  const rl = tenantAvatarRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. IDOR: look up tenant row by profile_id = ctx.userId (server-determined identity)
  const supabase = await createClient();
  const { data: tenantRow, error: tenantFetchError } = await supabase
    .from('tenants')
    .select('id, photo_url')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .limit(1)
    .single();

  if (tenantFetchError || !tenantRow) {
    log.warn('[updateOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRow.id;

  // 4. Validate uploaded file
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Errors.VALIDATION_ERROR({ file: ['File is required'] });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageFile(buffer, file.type);

  if (!validation.valid) {
    if (validation.error?.includes('exceeds')) return Errors.IMAGE_TOO_LARGE();
    return Errors.IMAGE_INVALID_MIME();
  }

  // 5. Delete old avatar from storage if one exists
  const existingPhotoUrl: string | null = tenantRow.photo_url ?? null;
  if (existingPhotoUrl) {
    // photo_url stores the storage path (e.g. "{orgId}/{tenantId}/{uuid}.ext")
    // Extract the path portion: strip any signed-URL prefix if present
    const oldPath = extractStoragePath(existingPhotoUrl);
    if (oldPath) {
      try {
        await deleteImage(TENANT_AVATAR_BUCKET, oldPath);
      } catch (err) {
        // Log but don't fail — stale objects are acceptable; new upload proceeds
        log.warn('[updateOwnTenantAvatar] old avatar delete failed', {
          path: oldPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 6. Build storage path and upload
  const storagePath = buildStoragePath(ctx.orgId, tenantId, file.type as import('@/lib/storage/index').AllowedMimeType);

  try {
    await uploadImage(TENANT_AVATAR_BUCKET, storagePath, buffer, file.type as import('@/lib/storage/index').AllowedMimeType);
  } catch (err) {
    log.error('[updateOwnTenantAvatar] upload failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return Errors.INTERNAL();
  }

  // 7. Persist new photo_url (store raw storage path — signed URL generated on read)
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ photo_url: storagePath, updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId);

  if (updateError) {
    log.error('[updateOwnTenantAvatar] db update failed', { code: updateError.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/profile');
  revalidatePath('/portal');

  return ok(undefined);
}

/**
 * Tenant self-service: delete own avatar.
 *
 * Security guarantees identical to updateOwnTenantAvatar — identity from
 * requireTenant() + tenant row lookup by profile_id, never client-supplied id.
 */
export async function deleteOwnTenantAvatar(
  _prev: ActionResult
): Promise<ActionResult> {
  // 1. Auth
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  // 2. Rate limit (5/min per tenant)
  const rl = tenantAvatarRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. IDOR: look up tenant row by profile_id = ctx.userId
  const supabase = await createClient();
  const { data: tenantRow, error: tenantFetchError } = await supabase
    .from('tenants')
    .select('id, photo_url')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .limit(1)
    .single();

  if (tenantFetchError || !tenantRow) {
    log.warn('[deleteOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRow.id;

  // 4. Delete from storage if a photo exists
  const existingPhotoUrl: string | null = tenantRow.photo_url ?? null;
  if (existingPhotoUrl) {
    const oldPath = extractStoragePath(existingPhotoUrl);
    if (oldPath) {
      try {
        await deleteImage(TENANT_AVATAR_BUCKET, oldPath);
      } catch (err) {
        log.warn('[deleteOwnTenantAvatar] storage delete failed', {
          path: oldPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 5. Clear photo_url in DB
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ photo_url: null, updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId);

  if (updateError) {
    log.error('[deleteOwnTenantAvatar] db update failed', { code: updateError.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/profile');

  return ok(undefined);
}

/**
 * Extracts the raw storage path from photo_url.
 *
 * photo_url may be stored as either:
 *   (a) a raw path: "{orgId}/{tenantId}/{uuid}.{ext}"
 *   (b) a signed URL: "https://...supabase.co/storage/v1/object/sign/tenant-avatars/{path}?token=..."
 *
 * In case (a), return the value as-is.
 * In case (b), extract the path segment after "tenant-avatars/".
 */
function extractStoragePath(photoUrl: string): string | null {
  if (!photoUrl) return null;

  // Signed URL pattern — extract path after bucket name
  const signedUrlMatch = photoUrl.match(/\/object\/sign\/tenant-avatars\/(.+?)(?:\?|$)/);
  if (signedUrlMatch?.[1]) {
    return decodeURIComponent(signedUrlMatch[1]);
  }

  // Public URL pattern
  const publicUrlMatch = photoUrl.match(/\/object\/public\/tenant-avatars\/(.+?)(?:\?|$)/);
  if (publicUrlMatch?.[1]) {
    return decodeURIComponent(publicUrlMatch[1]);
  }

  // Assume raw path (UUID-based path like "{orgId}/{tenantId}/{uuid}.jpg")
  if (!photoUrl.startsWith('http')) {
    return photoUrl;
  }

  return null;
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
