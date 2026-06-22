'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { tenants, units, profiles, internalNotes, notificationInbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

  try {
    await db.insert(tenants).values({
      ...parsed.data,
      orgId: ctx.orgId,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
    });
  } catch (e) {
    log.error('[createTenant] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db
      .update(tenants)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tenants.id, id), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateTenant] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant', 'tenant', id);
  revalidatePath('/dashboard/tenants');
  revalidatePath(`/dashboard/tenants/${id}`);
  return ok(undefined);
}

// ─── Phase 4: Tenant profile actions ─────────────────────────────────────────

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

  try {
    await db
      .update(tenants)
      .set({ photoUrl: parsed.data.photo_url, updatedAt: new Date() })
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateTenantAvatar] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db
      .update(tenants)
      .set({ preferredLanguage: parsed.data.preferred_language, updatedAt: new Date() })
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateTenantPreferredLanguage] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db
      .update(tenants)
      .set({
        whatsappPhone: parsed.data.whatsapp_phone || null,
        whatsappOptIn: parsed.data.whatsapp_opt_in === 'true',
        updatedAt: new Date(),
      })
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateTenantWhatsappPhone] db error', { code: e instanceof Error ? e.message : String(e) });
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

  // Verify tenant belongs to org
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) return Errors.NOT_FOUND();

  try {
    await db.insert(internalNotes).values({
      orgId: ctx.orgId,
      tenantId: parsed.data.tenant_id,
      content: parsed.data.content,
      createdBy: ctx.userId,
    });
  } catch (e) {
    log.error('[addInternalNote] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'add_internal_note', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

// ─── Tenant Portal Account Linking ───────────────────────────────────────────

/**
 * Search users by email in the profiles table (Drizzle replacement for Supabase auth.admin.listUsers).
 *
 * NOTE: In the Drizzle/NextAuth model there is no Supabase auth.users table.
 * Users are in the NextAuth `users` table. We search profiles by email instead.
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

  const normalizedEmail = parsed.data.email.toLowerCase();

  // Search profiles table by email — scoped to own org to prevent cross-org data leakage
  const rows = await db
    .select({ id: profiles.id, email: profiles.email, fullName: profiles.fullName })
    .from(profiles)
    .where(and(eq(profiles.email, normalizedEmail), eq(profiles.orgId, ctx.orgId)));

  const matches = rows.map(p => ({
    profileId: p.id,
    email: p.email ?? '',
    fullName: p.fullName ?? null,
  }));

  return ok({ matches });
}

/**
 * Link a tenant row to a portal account (profile).
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
  const tenantRows = await db
    .select({ id: tenants.id, profileId: tenants.profileId })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) {
    log.warn('[linkTenantPortalAccount] tenant not found or wrong org', { tenantId, orgId: ctx.orgId });
    return Errors.NOT_FOUND();
  }

  if (tenantRows[0].profileId) {
    return Errors.CONFLICT('Tenant already has a linked portal account');
  }

  // Step 2: Find the profile by email in this org
  const normalizedEmail = profileEmail.toLowerCase();
  const profileRows = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.email, normalizedEmail), eq(profiles.orgId, ctx.orgId)))
    .limit(1);

  if (!profileRows[0]) {
    return Errors.NOT_FOUND();
  }

  const profile = profileRows[0];

  if (profile.role !== 'tenant') {
    log.warn('[linkTenantPortalAccount] profile role mismatch', {
      profileId: profile.id,
      existingRole: profile.role,
    });
    return Errors.CONFLICT('The matched user already has an admin account in a different role');
  }

  const profileId = profile.id;

  // Step 3: Set tenants.profile_id
  try {
    await db
      .update(tenants)
      .set({ profileId, updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[linkTenantPortalAccount] tenants update error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  // Step 4: Audit log
  await db.insert(notificationInbox).values({
    orgId: ctx.orgId,
    profileId: ctx.userId,
    type: 'system',
    title: 'Tenant portal account linked',
    body: `Admin linked tenant ${tenantId} to portal account ${profileEmail}`,
  }).catch(() => undefined);

  log.adminAction(ctx.userId, 'link_tenant_portal_account', 'tenant', tenantId);
  revalidatePath(`/dashboard/tenants/${tenantId}`);
  revalidatePath('/dashboard/tenants');

  return ok({ profileId });
}

// ─── W3: Tenant self-service avatar ──────────────────────────────────────────

const TENANT_AVATAR_BUCKET = 'tenant-avatars';
const ONE_MINUTE_MS_TENANT = 60_000;

function tenantAvatarRateLimit(userId: string) {
  return actionRateLimit(`tenant-avatar:upload:${userId}`, 5, ONE_MINUTE_MS_TENANT);
}

export async function updateOwnTenantAvatar(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = tenantAvatarRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  // IDOR: look up tenant row by profile_id = ctx.userId
  const tenantRows = await db
    .select({ id: tenants.id, photoUrl: tenants.photoUrl })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) {
    log.warn('[updateOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRows[0].id;

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

  // Delete old avatar from storage if one exists
  const existingPhotoUrl: string | null = tenantRows[0].photoUrl ?? null;
  if (existingPhotoUrl) {
    const oldPath = extractStoragePath(existingPhotoUrl);
    if (oldPath) {
      try {
        await deleteImage(TENANT_AVATAR_BUCKET, oldPath);
      } catch (err) {
        log.warn('[updateOwnTenantAvatar] old avatar delete failed', {
          path: oldPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const storagePath = buildStoragePath(ctx.orgId, tenantId, file.type as import('@/lib/storage/index').AllowedMimeType);

  try {
    await uploadImage(TENANT_AVATAR_BUCKET, storagePath, buffer, file.type as import('@/lib/storage/index').AllowedMimeType);
  } catch (err) {
    log.error('[updateOwnTenantAvatar] upload failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return Errors.INTERNAL();
  }

  try {
    await db
      .update(tenants)
      .set({ photoUrl: storagePath, updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateOwnTenantAvatar] db update failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/profile');
  revalidatePath('/portal');

  return ok(undefined);
}

export async function deleteOwnTenantAvatar(
  _prev: ActionResult
): Promise<ActionResult> {
  void _prev;
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = tenantAvatarRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  const tenantRows = await db
    .select({ id: tenants.id, photoUrl: tenants.photoUrl })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) {
    log.warn('[deleteOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRows[0].id;

  const existingPhotoUrl: string | null = tenantRows[0].photoUrl ?? null;
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

  try {
    await db
      .update(tenants)
      .set({ photoUrl: null, updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[deleteOwnTenantAvatar] db update failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/profile');

  return ok(undefined);
}

function extractStoragePath(photoUrl: string): string | null {
  if (!photoUrl) return null;

  const signedUrlMatch = photoUrl.match(/\/object\/sign\/tenant-avatars\/(.+?)(?:\?|$)/);
  if (signedUrlMatch?.[1]) {
    return decodeURIComponent(signedUrlMatch[1]);
  }

  const publicUrlMatch = photoUrl.match(/\/object\/public\/tenant-avatars\/(.+?)(?:\?|$)/);
  if (publicUrlMatch?.[1]) {
    return decodeURIComponent(publicUrlMatch[1]);
  }

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

  // Verify both tenant and unit belong to this org
  const [tenantRows, unitRows] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId))).limit(1),
    db.select({ id: units.id, status: units.status }).from(units)
      .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId))).limit(1),
  ]);

  if (!tenantRows[0]) return Errors.NOT_FOUND();
  if (!unitRows[0]) return Errors.NOT_FOUND();

  // Update tenant's unit_id and flip unit to occupied
  const [tenantUpdateErr, unitUpdateErr] = await Promise.all([
    db.update(tenants).set({ unitId: parsed.data.unit_id, updatedAt: new Date() })
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
      .catch((e: Error) => e),
    db.update(units).set({ status: 'occupied', updatedAt: new Date() })
      .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId)))
      .catch((e: Error) => e),
  ]);

  if (tenantUpdateErr instanceof Error || unitUpdateErr instanceof Error) {
    log.error('[assignTenantToUnit] db error', {
      tenantErr: tenantUpdateErr instanceof Error ? tenantUpdateErr.message : undefined,
      unitErr: unitUpdateErr instanceof Error ? unitUpdateErr.message : undefined,
    });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'assign_tenant_to_unit', 'tenant', parsed.data.tenant_id);
  revalidatePath('/dashboard/tenants');
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
