/**
 * Zod schemas for tenant avatar (profile photo) upload validation.
 *
 * AC10: Tenant uploads own avatar from portal — old photo replaced.
 * AC11: Tenant removes own avatar — photo_url cleared + storage deleted.
 */

import { z } from 'zod';

export const TENANT_AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TenantAvatarMimeType = (typeof TENANT_AVATAR_ALLOWED_MIME_TYPES)[number];

export const TENANT_AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const AdminUploadTenantAvatarSchema = z.object({
  tenant_id: z.string().uuid(),
});

export type AdminUploadTenantAvatarInput = z.infer<typeof AdminUploadTenantAvatarSchema>;
