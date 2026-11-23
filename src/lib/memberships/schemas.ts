import { z } from 'zod';

export const MEMBER_ROLES = ['admin', 'tenant'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const AddMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(MEMBER_ROLES),
});

export const RemoveMemberSchema = z.object({
  id: z.string().guid(),
});

export const SwitchCommunitySchema = z.object({
  org_id: z.string().min(1).max(64),
});
