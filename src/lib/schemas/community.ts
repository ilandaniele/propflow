import { z } from 'zod';

export const CommunityPostSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(5000),
  category: z.enum(['general', 'question', 'marketplace', 'event']).default('general'),
});
export type CommunityPostInput = z.infer<typeof CommunityPostSchema>;

export const UpdateCommunityPostSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(5000).optional(),
  category: z.enum(['general', 'question', 'marketplace', 'event']).optional(),
});
export type UpdateCommunityPostInput = z.infer<typeof UpdateCommunityPostSchema>;

export const PinPostSchema = z.object({
  id: z.string().uuid(),
  pinned: z.enum(['true', 'false']).transform(v => v === 'true'),
});
export type PinPostInput = z.infer<typeof PinPostSchema>;

export const CommunityCommentSchema = z.object({
  post_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
});
export type CommunityCommentInput = z.infer<typeof CommunityCommentSchema>;

export const VisitorLogSchema = z.object({
  property_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  visitor_name: z.string().min(1).max(200),
  host_tenant_id: z.string().uuid().optional(),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entry_time: z.string().datetime().optional(),
  purpose: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
});
export type VisitorLogInput = z.infer<typeof VisitorLogSchema>;

export const UpdateVisitorLogSchema = z.object({
  id: z.string().uuid(),
  exit_time: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateVisitorLogInput = z.infer<typeof UpdateVisitorLogSchema>;
