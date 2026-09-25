'use server';

/**
 * Staff-facing actions for the LeadSettingsCard (item F, blueprint §7):
 * routing mode/members and the follow-up policy toggles. Reads/writes the
 * routing members through src/lib/leads/routing.ts (item D) and merges the
 * follow-up policy into agent_configs.followup_policy (item A's JSONB
 * contract, src/lib/leads/types.ts).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { agentConfigs } from '@/lib/db/schema';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { removeRoutingMember, RoutingMemberForbiddenError, upsertRoutingMember } from '@/lib/leads/routing';
import { parseFollowupPolicy } from '@/lib/leads/types';
import type { ActionResult } from '@/lib/errors';

const LEADS_PATH = '/dashboard/leads';

// ─── saveRoutingMode ────────────────────────────────────────────────────────

const SaveRoutingModeSchema = z.object({ mode: z.enum(['round_robin', 'weighted', 'manual']) });

export type SaveRoutingModeInput = z.infer<typeof SaveRoutingModeSchema>;

export async function saveRoutingMode(input: SaveRoutingModeInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_routing_mode');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveRoutingModeSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await getOrCreateAgentConfig(ctx.orgId);
  await db.update(agentConfigs).set({ routingMode: parsed.data.mode, updatedAt: new Date() }).where(eq(agentConfigs.orgId, ctx.orgId));

  log.adminAction(ctx.userId, 'leads_routing_mode', 'agent_config', ctx.orgId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── upsertRoutingMemberAction ──────────────────────────────────────────────

const UpsertRoutingMemberSchema = z.object({
  profileId: z.string().uuid(),
  pipeline: z.enum(['demand', 'supply', 'both']),
  weight: z.number().int().min(1).max(100),
  active: z.boolean(),
  maxOpenLeads: z.number().int().positive().nullable(),
});

export type UpsertRoutingMemberInput = z.infer<typeof UpsertRoutingMemberSchema>;

export async function upsertRoutingMemberAction(input: UpsertRoutingMemberInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_routing_member_upsert');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpsertRoutingMemberSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await upsertRoutingMember(ctx.orgId, parsed.data);
  } catch (e) {
    if (e instanceof RoutingMemberForbiddenError) return Errors.FORBIDDEN();
    log.error('[actions/lead-routing] upsertRoutingMember failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : 'unknown' });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'leads_routing_member_upsert', 'lead_routing_member', parsed.data.profileId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── removeRoutingMemberAction ──────────────────────────────────────────────

const RemoveRoutingMemberSchema = z.object({ profileId: z.string().uuid() });

export type RemoveRoutingMemberInput = z.infer<typeof RemoveRoutingMemberSchema>;

export async function removeRoutingMemberAction(input: RemoveRoutingMemberInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_routing_member_remove');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RemoveRoutingMemberSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await removeRoutingMember(ctx.orgId, parsed.data.profileId);

  log.adminAction(ctx.userId, 'leads_routing_member_remove', 'lead_routing_member', parsed.data.profileId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── saveFollowupPolicy ─────────────────────────────────────────────────────

const SaveFollowupPolicySchema = z.object({
  enabled: z.boolean(),
  listingAlertsEnabled: z.boolean(),
});

export type SaveFollowupPolicyInput = z.infer<typeof SaveFollowupPolicySchema>;

export async function saveFollowupPolicy(input: SaveFollowupPolicyInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_followup_policy');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveFollowupPolicySchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const config = await getOrCreateAgentConfig(ctx.orgId);
  const current = parseFollowupPolicy(config.followupPolicy);
  const merged = {
    ...current,
    enabled: parsed.data.enabled,
    listingAlerts: { ...current.listingAlerts, enabled: parsed.data.listingAlertsEnabled },
  };

  await db.update(agentConfigs).set({ followupPolicy: merged, updatedAt: new Date() }).where(eq(agentConfigs.orgId, ctx.orgId));

  log.adminAction(ctx.userId, 'leads_followup_policy', 'agent_config', ctx.orgId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}
