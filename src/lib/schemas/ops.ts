import { z } from 'zod';

export const AnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  audience: z.enum(['all', 'property', 'unit']).default('all'),
  property_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().optional(),
});
export type AnnouncementInput = z.infer<typeof AnnouncementSchema>;

export const PublishAnnouncementSchema = z.object({
  id: z.string().uuid(),
});
export type PublishAnnouncementInput = z.infer<typeof PublishAnnouncementSchema>;

export const CleaningTaskSchema = z.object({
  unit_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
});
export type CleaningTaskInput = z.infer<typeof CleaningTaskSchema>;

export const UpdateCleaningTaskSchema = z.object({
  id: z.string().uuid(),
  unit_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  title: z.string().min(1).max(300).optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateCleaningTaskInput = z.infer<typeof UpdateCleaningTaskSchema>;

export const LeadSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  property_interest: z.string().max(300).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});
export type LeadInput = z.infer<typeof LeadSchema>;

export const UpdateLeadSchema = LeadSchema.extend({
  id: z.string().uuid(),
  status: z.enum(['new', 'contacted', 'qualified', 'lost']).optional(),
});
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const ScheduleReminderSchema = z.object({
  type: z.literal('custom'),
  target_type: z.enum(['contract', 'charge', 'tenant']),
  target_id: z.string().uuid(),
  channel: z.enum(['email', 'in_app', 'both']).default('both'),
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  message_preview: z.string().max(500).optional(),
});
export type ScheduleReminderInput = z.infer<typeof ScheduleReminderSchema>;

export const MarkNotificationReadSchema = z.object({
  notification_id: z.string().uuid(),
});
export type MarkNotificationReadInput = z.infer<typeof MarkNotificationReadSchema>;
