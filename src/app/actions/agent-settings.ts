'use server';

/**
 * Admin-only Server Actions for /dashboard/agent/settings (item D). Every
 * action takes a plain object (not FormData — the settings page's forms are
 * per-tab and post typed values directly), validates it against
 * config-schema.ts (the single source of truth shared with config.ts and the
 * voice modules), then writes through updateAgentConfig(ctx.orgId, patch) so
 * the org scope always comes from the session, never from client input.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { E164_RE } from '@/lib/widget/channel';
import {
  BusinessHoursSchema,
  IdentitySchema,
  KnowledgeSchema,
  LimitsSchema,
  VoiceConfigSchema,
  type BusinessHours,
  type VoiceConfig,
} from '@/lib/agent/config-schema';
import { updateAgentConfig } from '@/lib/agent/config';
import { getOrgVoiceChannel } from '@/lib/agent/voice/calls';
import { addDoNotCall, removeDoNotCall } from '@/lib/agent/voice/dnc';
import { FollowupPolicySchema, type FollowupPolicy } from '@/lib/leads/types';
import { toE164 } from '@/lib/whatsapp/phone';
import type { ActionResult } from '@/lib/errors';

const SETTINGS_PATH = '/dashboard/agent/settings';

async function guard(action: string): Promise<{ ok: true; ctx: { userId: string; orgId: string } } | { ok: false; result: ActionResult<never> }> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return { ok: false, result: Errors.UNAUTHORIZED() };
  }
  const rl = mutationRateLimit(ctx.userId, action);
  if (!rl.success) return { ok: false, result: Errors.RATE_LIMITED() };
  return { ok: true, ctx };
}

// ─── saveAgentIdentity ──────────────────────────────────────────────────────

export type SaveAgentIdentityInput = z.infer<typeof IdentitySchema>;

export async function saveAgentIdentity(input: SaveAgentIdentityInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_identity');
  if (!g.ok) return g.result;

  const parsed = IdentitySchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await updateAgentConfig(g.ctx.orgId, {
    persona: parsed.data.persona,
    tone: parsed.data.tone,
    timezone: parsed.data.timezone,
  });

  log.adminAction(g.ctx.userId, 'agent_settings_identity', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── saveAgentKnowledge ─────────────────────────────────────────────────────

export type SaveAgentKnowledgeInput = z.infer<typeof KnowledgeSchema>;

export async function saveAgentKnowledge(input: SaveAgentKnowledgeInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_knowledge');
  if (!g.ok) return g.result;

  const parsed = KnowledgeSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await updateAgentConfig(g.ctx.orgId, {
    rules: parsed.data.rules,
    prohibited: parsed.data.prohibited,
    faq: parsed.data.faq,
    qualificationFields: [...parsed.data.qualificationFields],
  });

  log.adminAction(g.ctx.userId, 'agent_settings_knowledge', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── saveAgentBusinessHours ─────────────────────────────────────────────────

export type SaveAgentBusinessHoursInput = BusinessHours;

export async function saveAgentBusinessHours(input: SaveAgentBusinessHoursInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_hours');
  if (!g.ok) return g.result;

  const parsed = BusinessHoursSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await updateAgentConfig(g.ctx.orgId, { businessHours: parsed.data });

  log.adminAction(g.ctx.userId, 'agent_settings_hours', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── saveAgentFollowupPolicy ────────────────────────────────────────────────

const MAX_FOLLOWUP_STEPS = 5;

export type SaveAgentFollowupPolicyInput = FollowupPolicy;

export async function saveAgentFollowupPolicy(input: SaveAgentFollowupPolicyInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_followups');
  if (!g.ok) return g.result;

  const parsed = FollowupPolicySchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (parsed.data.steps.length > MAX_FOLLOWUP_STEPS) {
    return Errors.VALIDATION_ERROR({ formErrors: [`Máximo ${MAX_FOLLOWUP_STEPS} pasos`], fieldErrors: {} });
  }
  for (let i = 1; i < parsed.data.steps.length; i++) {
    if (parsed.data.steps[i].afterMinutes <= parsed.data.steps[i - 1].afterMinutes) {
      return Errors.VALIDATION_ERROR({ formErrors: ['Los pasos deben tener minutos crecientes'], fieldErrors: {} });
    }
  }

  await updateAgentConfig(g.ctx.orgId, { followupPolicy: parsed.data });

  log.adminAction(g.ctx.userId, 'agent_settings_followups', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── saveAgentLimits ────────────────────────────────────────────────────────

export type SaveAgentLimitsInput = z.infer<typeof LimitsSchema>;

export async function saveAgentLimits(input: SaveAgentLimitsInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_limits');
  if (!g.ok) return g.result;

  const parsed = LimitsSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (parsed.data.voiceEnabled) {
    const channel = await getOrgVoiceChannel(g.ctx.orgId);
    if (!channel) {
      return Errors.VALIDATION_ERROR({
        formErrors: [],
        fieldErrors: { voiceEnabled: ['Esta organización todavía no tiene un número de voz configurado.'] },
      });
    }
  }

  await updateAgentConfig(g.ctx.orgId, {
    channels: { whatsapp: parsed.data.whatsappEnabled, voice: parsed.data.voiceEnabled },
    dailyTokenBudget: parsed.data.dailyTokenBudget,
    shadowMode: parsed.data.shadowMode,
    maxAgentTurns: parsed.data.maxAgentTurns,
    maxActiveVisitsPerPhone: parsed.data.maxActiveVisitsPerPhone,
    maxListingPhotos: parsed.data.maxListingPhotos,
  });

  log.adminAction(g.ctx.userId, 'agent_settings_limits', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── saveAgentVoiceConfig ───────────────────────────────────────────────────

export type SaveAgentVoiceConfigInput = VoiceConfig;

export async function saveAgentVoiceConfig(input: SaveAgentVoiceConfigInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_voice');
  if (!g.ok) return g.result;

  const parsed = VoiceConfigSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await updateAgentConfig(g.ctx.orgId, { voice: parsed.data });

  log.adminAction(g.ctx.userId, 'agent_settings_voice', 'agent_config', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── addDoNotCallNumber ─────────────────────────────────────────────────────

const AddDoNotCallSchema = z.object({
  phone: z.string().min(1),
  reason: z.string().max(200).optional(),
});

export type AddDoNotCallInput = z.infer<typeof AddDoNotCallSchema>;

export async function addDoNotCallNumber(input: AddDoNotCallInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_dnc_add');
  if (!g.ok) return g.result;

  const parsed = AddDoNotCallSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const phoneE164 = toE164(parsed.data.phone);
  if (!E164_RE.test(phoneE164)) {
    return Errors.VALIDATION_ERROR({ formErrors: [], fieldErrors: { phone: ['Debe ser un teléfono E.164, ej. +51987654321'] } });
  }

  await addDoNotCall({
    orgId: g.ctx.orgId,
    phoneE164,
    source: 'staff',
    reason: parsed.data.reason ?? null,
    profileId: g.ctx.userId,
  });

  // No phone in the audit log's resourceId — the number itself is the sensitive part.
  log.adminAction(g.ctx.userId, 'agent_settings_dnc_add', 'voice_do_not_call', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}

// ─── removeDoNotCallNumber ──────────────────────────────────────────────────

const RemoveDoNotCallSchema = z.object({ phone: z.string().min(1) });

export type RemoveDoNotCallInput = z.infer<typeof RemoveDoNotCallSchema>;

export async function removeDoNotCallNumber(input: RemoveDoNotCallInput): Promise<ActionResult<null>> {
  const g = await guard('agent_settings_dnc_remove');
  if (!g.ok) return g.result;

  const parsed = RemoveDoNotCallSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const phoneE164 = toE164(parsed.data.phone);
  const result = await removeDoNotCall(g.ctx.orgId, phoneE164);
  if (result === 'protected') return Errors.FORBIDDEN();
  // 'not_found' is treated as success (idempotent remove) — nothing to leak either way.

  log.adminAction(g.ctx.userId, 'agent_settings_dnc_remove', 'voice_do_not_call', g.ctx.orgId);
  revalidatePath(SETTINGS_PATH);
  return ok(null);
}
