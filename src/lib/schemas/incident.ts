import { z } from 'zod';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const CreateIncidentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().min(1, 'Description is required').max(10_000),
  category: z.enum(['plumbing', 'electrical', 'appliance', 'structural', 'cleaning', 'other', 'material_damage', 'malfunction']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  unit_id: z.string().guid().optional().or(z.literal('')),
  property_id: z.string().guid().optional().or(z.literal('')),
  tenant_id: z.string().guid().optional().or(z.literal('')),
});

export const UpdateIncidentSchema = z.object({
  id: z.string().guid(),
  status: z.enum(['pending', 'in_progress', 'solved']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigned_to: z.string().guid().optional().or(z.literal('')),
  title: z.string().min(1).max(300).optional(),
  description: z.string().min(1).max(10_000).optional(),
  estimated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

export const AddCommentSchema = z.object({
  incident_id: z.string().guid(),
  body: z.string().min(1, 'Comment cannot be empty').max(5_000),
});

export const PhotoUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    error: 'Only PNG, JPEG, and WebP images are allowed',
  }),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES, `File must be under 5 MB`),
});

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };

export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;
export type AddCommentInput = z.infer<typeof AddCommentSchema>;
export type PhotoUploadInput = z.infer<typeof PhotoUploadSchema>;
