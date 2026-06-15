'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { tenants, units, profiles, users, notificationInbox, internalNotes } from '@/lib/db/schema';
import { eq, and, ilike } from 'drizzle-orm';
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

  const { full_name, ...rest } = parsed.data;
  try {
    await db.insert(tenants).values({
      ...rest,
      fullName: full_name,
      orgId: ctx.orgId,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
    });
  } catch (err) {
    log.error('[createTenant] db error', { err: err instanceof Error ? err.message : String(err) });
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
  } catch (err) {
    log.error('[updateTenant] db error', { err: err instanceof Error ? err.message : String(err) });
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
  } catch (err) {
    log.error('[updateTenantAvatar] db error', { err: err instanceof Error ? err.message : String(err) });
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
  } catch (err) {
    log.error('[updateTenantPreferredLanguage] db error', { err: err instanceof Error ? err.message : String(err) });
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
  } catch (err) {
    log.error('[updateTenantWhatsappPhone] db error', { err: err instanceof Error ? err.message : String(err) });
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
  const tenant = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenant) return Errors.NOT_FOUND();

  try {
    await db.insert(internalNotes).values({
      orgId: ctx.orgId,
      tenantId: parsed.data.tenant_id,
      content: parsed.data.content,
      createdBy: ctx.userId,
    });
  } catch (err) {
    log.error('[addInternalNote] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'add_internal_note', 'tenant', parsed.data.tenant_id);
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

// ─── Tenant Portal Account Linking ───────────────────────────────────────────

/**
 * Search NextAuth users by email address (case-insensitive).
 *
 * Replaced Supabase auth.admin.listUsers() with Drizzle query against
 * the NextAuth `users` table and cross-references with `profiles`.
 * Admin-only guard applied at the start.
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

  // Search NextAuth users table by email (case-insensitive via ilike)
  const matchingUsers = await db.select({ id: users.id, email: users.email })
    .from(users)
    .where(ilike(users.email, parsed.data.email));

  if (matchingUsers.length === 0) {
    return ok({ matches: [] });
  }

  // Fetch profiles for matched users
  const matchedIds = matchingUsers.map(u => u.id);
  const profileRows = await db.select({ userId: profiles.userId, fullName: profiles.fullName, email: profiles.email })
    .from(profiles)
    .where(
      matchedIds.length === 1
        ? eq(profiles.userId, matchedIds[0])
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle inArray needs the same column type
          (await import('drizzle-orm')).inArray(profiles.userId, matchedIds)
    );

  const profileMap = new Map(profileRows.map(p => [p.userId, p]));

  const matches = matchingUsers.map(u => {
    const profile = profileMap.get(u.id);
    return {
      profileId: u.id,
      email: u.email ?? '',
      fullName: profile?.fullName ?? null,
    };
  });

  return ok({ matches });
}

/**
 * Link a tenant row to a portal account (NextAuth user profile).
 *
 * Security guarantees:
 * 1. requireAdmin() — caller must be an authenticated admin.
 * 2. mutationRateLimit — prevents brute-force linking.
 * 3. Zod validation on tenantId (uuid) and profileEmail (email).
 * 4. IDOR guard: tenant must belong to ctx.orgId before any write.
 * 5. Uses Drizzle queries on NextAuth users + profiles tables.
 * 6. Audit log row written to notification_inbox.
 *
 * Flow:
 * a. Find the NextAuth user by email.
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
  const tenant = await db.select({ id: tenants.id, orgId: tenants.orgId, email: tenants.email, profileId: tenants.profileId })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenant) {
    log.warn('[linkTenantPortalAccount] tenant not found or wrong org', { tenantId, orgId: ctx.orgId });
    return Errors.NOT_FOUND();
  }

  if (tenant.profileId) {
    return Errors.CONFLICT('Tenant already has a linked portal account');
  }

  // Step 2: Find the NextAuth user by email (Drizzle users table)
  const matchedUser = await db.select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(ilike(users.email, profileEmail))
    .then(r => r[0] ?? null);

  if (!matchedUser) {
    return Errors.NOT_FOUND();
  }

  const authUserId = matchedUser.id;

  // Step 3: Find or create a profiles row for this user
  const existingProfile = await db.select({ id: profiles.id, role: profiles.role, orgId: profiles.orgId })
    .from(profiles)
    .where(eq(profiles.userId, authUserId))
    .then(r => r[0] ?? null);

  let profileId: string;

  if (!existingProfile) {
    // Create a new tenant profile
    try {
      const [newProfile] = await db.insert(profiles).values({
        userId: authUserId,
        orgId: ctx.orgId,
        role: 'tenant',
        fullName: matchedUser.name ?? null,
        email: matchedUser.email ?? profileEmail,
      }).returning({ id: profiles.id });
      profileId = newProfile.id;

      log.info('[linkTenantPortalAccount] created tenant profile', {
        event: 'tenant_profile_created',
        authUserId,
        orgId: ctx.orgId,
      });
    } catch (err) {
      log.error('[linkTenantPortalAccount] profile insert error', { err: err instanceof Error ? err.message : String(err) });
      return Errors.INTERNAL();
    }
  } else {
    // Profile exists — check role compatibility
    if (existingProfile.role !== 'tenant') {
      log.warn('[linkTenantPortalAccount] profile role mismatch', {
        authUserId,
        existingRole: existingProfile.role,
      });
      return Errors.CONFLICT('The matched user already has an admin account in a different role');
    }
    profileId = existingProfile.id;
  }

  // Step 4: Set tenants.profile_id
  try {
    await db
      .update(tenants)
      .set({ profileId, updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[linkTenantPortalAccount] tenants update error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  // Step 5: Audit log
  await db.insert(notificationInbox).values({
    orgId: ctx.orgId,
    profileId: ctx.userId,
    type: 'system',
    title: 'Tenant portal account linked',
    body: `Admin linked tenant ${tenantId} to portal account ${profileEmail}`,
  }).catch(() => {}); // non-fatal

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
  const tenantRow = await db.select({ id: tenants.id, photoUrl: tenants.photoUrl })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1)
    .then(r => r[0] ?? null);

  if (!tenantRow) {
    log.warn('[updateOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRow.id;

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

  const existingPhotoUrl: string | null = tenantRow.photoUrl ?? null;
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
  } catch (err) {
    log.error('[updateOwnTenantAvatar] db update failed', { err: err instanceof Error ? err.message : String(err) });
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

  const tenantRow = await db.select({ id: tenants.id, photoUrl: tenants.photoUrl })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1)
    .then(r => r[0] ?? null);

  if (!tenantRow) {
    log.warn('[deleteOwnTenantAvatar] no tenant row for profile', { userId: ctx.userId });
    return Errors.FORBIDDEN();
  }

  const tenantId: string = tenantRow.id;

  const existingPhotoUrl: string | null = tenantRow.photoUrl ?? null;
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
  } catch (err) {
    log.error('[deleteOwnTenantAvatar] db update failed', { err: err instanceof Error ? err.message : String(err) });
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
  const [tenantRow, unitRow] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
    db.select({ id: units.id, status: units.status }).from(units)
      .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
  ]);

  if (!tenantRow) return Errors.NOT_FOUND();
  if (!unitRow) return Errors.NOT_FOUND();

  // Update tenant's unit_id and flip unit to occupied
  try {
    await Promise.all([
      db.update(tenants)
        .set({ unitId: parsed.data.unit_id, updatedAt: new Date() })
        .where(eq(tenants.id, parsed.data.tenant_id)),
      db.update(units)
        .set({ status: 'occupied', updatedAt: new Date() })
        .where(eq(units.id, parsed.data.unit_id)),
    ]);
  } catch (err) {
    log.error('[assignTenantToUnit] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'assign_tenant_to_unit', 'tenant', parsed.data.tenant_id);
  revalidatePath('/dashboard/tenants');
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
