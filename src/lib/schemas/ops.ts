import { z } from 'zod';

const optionalGuid = z.preprocess((value) => (value === '' ? undefined : value), z.string().guid().optional());
const checkbox = z.literal('on').optional().transform((value) => value === 'on');

export const AnnouncementSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    audience: z.enum(['all', 'property', 'unit']).default('all'),
    property_id: optionalGuid,
    unit_id: optionalGuid,
    expires_at: z.string().datetime().optional(),
    pinned: checkbox,
    important: checkbox,
  })
  .refine((data) => data.audience !== 'property' || data.property_id, { path: ['property_id'], message: 'Choose a property' })
  .refine((data) => data.audience !== 'unit' || data.unit_id, { path: ['unit_id'], message: 'Choose a unit' })
  .transform((data) => ({
    ...data,
    property_id: data.audience === 'property' ? data.property_id : undefined,
    unit_id: data.audience === 'unit' ? data.unit_id : undefined,
  }));
export type AnnouncementInput = z.infer<typeof AnnouncementSchema>;

export const PublishAnnouncementSchema = z.object({
  id: z.string().guid(),
});

export const PinAnnouncementSchema = z.object({
  id: z.string().guid(),
  pinned: z.enum(['true', 'false']).transform((value) => value === 'true'),
});
export type PublishAnnouncementInput = z.infer<typeof PublishAnnouncementSchema>;

export const CleaningTaskSchema = z.object({
  unit_id: z.string().guid().optional(),
  assigned_to: z.string().guid().optional(),
  title: z.string().min(1).max(300),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
});
export type CleaningTaskInput = z.infer<typeof CleaningTaskSchema>;

export const UpdateCleaningTaskSchema = z.object({
  id: z.string().guid(),
  unit_id: z.string().guid().optional(),
  assigned_to: z.string().guid().optional(),
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
  id: z.string().guid(),
  status: z.enum(['new', 'contacted', 'qualified', 'lost']).optional(),
});
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const ScheduleReminderSchema = z.object({
  type: z.literal('custom'),
  target_type: z.enum(['contract', 'charge', 'tenant']),
  target_id: z.string().guid(),
  channel: z.enum(['email', 'in_app', 'both']).default('both'),
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  message_preview: z.string().max(500).optional(),
});
export type ScheduleReminderInput = z.infer<typeof ScheduleReminderSchema>;

export const MarkNotificationReadSchema = z.object({
  notification_id: z.string().guid(),
});
export type MarkNotificationReadInput = z.infer<typeof MarkNotificationReadSchema>;
