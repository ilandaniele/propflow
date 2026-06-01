import { z } from 'zod';

export const TASK_TYPES = ['maintenance', 'document', 'inspection', 'cleanup', 'custom'] as const;
export type TaskType = typeof TASK_TYPES[number];

export const TASK_STATUSES = ['pending', 'in_progress', 'proof_pending_review', 'completed', 'expired', 'cancelled'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const CreateTenantTaskSchema = z.object({
  tenant_id: z.string().uuid(),
  task_type: z.enum(TASK_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  due_at: z.string().datetime({ message: 'ISO8601 datetime required' }),
});
export type CreateTenantTaskInput = z.infer<typeof CreateTenantTaskSchema>;

export const UpdateTenantTaskSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(TASK_STATUSES).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  due_at: z.string().datetime().optional(),
});
export type UpdateTenantTaskInput = z.infer<typeof UpdateTenantTaskSchema>;

export const CancelTenantTaskSchema = z.object({
  id: z.string().uuid(),
});
