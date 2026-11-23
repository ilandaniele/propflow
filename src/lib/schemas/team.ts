import { z } from 'zod';
import { STAFF_ROLES } from '@/lib/auth/permissions';

export const SetStaffRoleSchema = z.object({
  profile_id: z.string().guid(),
  role: z.enum(['admin', ...STAFF_ROLES]),
});
export type SetStaffRoleInput = z.infer<typeof SetStaffRoleSchema>;
