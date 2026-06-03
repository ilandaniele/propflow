import { z } from 'zod';

/**
 * Schema for linking a tenant row to an auth user profile.
 * Admin-only: sets tenants.profile_id after verifying org ownership.
 */
export const LinkTenantPortalAccountSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a UUID'),
  profileEmail: z.string().email('profileEmail must be a valid email address'),
});

export type LinkTenantPortalAccountInput = z.infer<typeof LinkTenantPortalAccountSchema>;

/**
 * Schema for searching auth users by email (admin-only lookup).
 */
export const SearchAuthUserByEmailSchema = z.object({
  email: z.string().email('email must be a valid email address'),
});

export type SearchAuthUserByEmailInput = z.infer<typeof SearchAuthUserByEmailSchema>;
