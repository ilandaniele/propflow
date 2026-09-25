'use server';

/**
 * Staff-facing actions for the /dashboard/leads dual-pipeline kanban (item
 * F, blueprint §7): stage moves, assignment and stage-list management.
 * Stage reads/writes go through src/lib/leads/stages.ts (item A); routing
 * and follow-up stopping go through src/lib/leads/{routing,followups}.ts
 * (items D/E — see the header comment in those files for why they're
 * present as stubs in this worktree).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { crmLeads, leadPipelineStages } from '@/lib/db/schema';
import { getPipelineStages, getStage, slugifyStageKey } from '@/lib/leads/stages';
import { assignLeadManually, routeLead } from '@/lib/leads/routing';
import { stopFollowups } from '@/lib/leads/followups';
import { STAGE_KEY_RE, type Pipeline, type StageKind } from '@/lib/leads/types';
import type { ActionResult } from '@/lib/errors';

const LEADS_PATH = '/dashboard/leads';
const PIPELINES = ['demand', 'supply'] as const;
const STAGE_KINDS = ['open', 'won', 'lost'] as const;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Loads a lead scoped to the caller's org — IDOR-safe. */
async function loadOrgLead(orgId: string, leadId: string) {
  const rows = await db.select({ id: crmLeads.id, pipeline: crmLeads.pipeline, assignedProfileId: crmLeads.assignedProfileId })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── moveLeadStage ──────────────────────────────────────────────────────────

const MoveLeadStageSchema = z.object({
  leadId: z.string().uuid(),
  stage: z.string().regex(STAGE_KEY_RE),
});

export type MoveLeadStageInput = z.infer<typeof MoveLeadStageSchema>;

export async function moveLeadStage(input: MoveLeadStageInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_move_stage');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = MoveLeadStageSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const lead = await loadOrgLead(ctx.orgId, data.leadId);
  if (!lead) return Errors.NOT_FOUND();

  const stage = await getStage(ctx.orgId, lead.pipeline as Pipeline, data.stage);
  if (!stage || stage.archived) return Errors.VALIDATION_ERROR({ formErrors: ['La etapa elegida no existe en este pipeline'], fieldErrors: {} });

  await db.update(crmLeads)
    .set({ stage: data.stage, stageChangedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(crmLeads.id, data.leadId), eq(crmLeads.orgId, ctx.orgId)));

  if (stage.kind === 'won' || stage.kind === 'lost') {
    await stopFollowups(ctx.orgId, data.leadId, 'stage_closed');
  }

  log.adminAction(ctx.userId, 'leads_move_stage', 'crm_lead', data.leadId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── assignLead ─────────────────────────────────────────────────────────────

const AssignLeadSchema = z.object({
  leadId: z.string().uuid(),
  profileId: z.string().uuid().nullable(),
});

export type AssignLeadInput = z.infer<typeof AssignLeadSchema>;

export async function assignLead(input: AssignLeadInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_assign');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AssignLeadSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const result = await assignLeadManually({ orgId: ctx.orgId, leadId: data.leadId, profileId: data.profileId, actorProfileId: ctx.userId });
  if (!result.ok) {
    if (result.reason === 'not_found') return Errors.NOT_FOUND();
    return Errors.VALIDATION_ERROR({ formErrors: ['El asesor seleccionado no es válido'], fieldErrors: {} });
  }

  log.adminAction(ctx.userId, 'leads_assign', 'crm_lead', data.leadId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── autoAssignLead ─────────────────────────────────────────────────────────

const AutoAssignLeadSchema = z.object({ leadId: z.string().uuid() });

export type AutoAssignLeadInput = z.infer<typeof AutoAssignLeadSchema>;

export async function autoAssignLead(input: AutoAssignLeadInput): Promise<ActionResult<{ profileId: string | null }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_auto_assign');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AutoAssignLeadSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const lead = await loadOrgLead(ctx.orgId, parsed.data.leadId);
  if (!lead) return Errors.NOT_FOUND();

  const result = await routeLead({ orgId: ctx.orgId, leadId: parsed.data.leadId });

  log.adminAction(ctx.userId, 'leads_auto_assign', 'crm_lead', parsed.data.leadId);
  revalidatePath(LEADS_PATH);
  return ok({ profileId: result.profileId });
}

// ─── setDoNotContact ────────────────────────────────────────────────────────

const SetDoNotContactSchema = z.object({
  leadId: z.string().uuid(),
  value: z.boolean(),
});

export type SetDoNotContactInput = z.infer<typeof SetDoNotContactSchema>;

export async function setDoNotContact(input: SetDoNotContactInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_do_not_contact');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SetDoNotContactSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const lead = await loadOrgLead(ctx.orgId, data.leadId);
  if (!lead) return Errors.NOT_FOUND();

  await db.update(crmLeads)
    .set({ doNotContact: data.value, updatedAt: new Date() })
    .where(and(eq(crmLeads.id, data.leadId), eq(crmLeads.orgId, ctx.orgId)));

  if (data.value) await stopFollowups(ctx.orgId, data.leadId, 'do_not_contact');

  log.adminAction(ctx.userId, 'leads_do_not_contact', 'crm_lead', data.leadId);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── createStage ────────────────────────────────────────────────────────────

const CreateStageSchema = z.object({
  pipeline: z.enum(PIPELINES),
  label: z.string().min(1).max(60),
  kind: z.enum(STAGE_KINDS),
  color: z.string().regex(COLOR_RE).nullable().optional(),
});

export type CreateStageInput = z.infer<typeof CreateStageSchema>;

export async function createStage(input: CreateStageInput): Promise<ActionResult<{ key: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_create_stage');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreateStageSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data as { pipeline: Pipeline; label: string; kind: StageKind; color?: string | null };

  const existing = await getPipelineStages(ctx.orgId, data.pipeline, { includeArchived: true });
  const existingKeys = new Set(existing.map((s) => s.key));

  let key = slugifyStageKey(data.label);
  if (existingKeys.has(key)) {
    let suffix = 2;
    while (existingKeys.has(`${key.slice(0, 36)}_${suffix}`)) suffix++;
    key = `${key.slice(0, 36)}_${suffix}`;
  }

  const position = existing.reduce((max, s) => Math.max(max, s.position), -1) + 1;

  await db.insert(leadPipelineStages).values({
    orgId: ctx.orgId, pipeline: data.pipeline, key, label: data.label, position,
    kind: data.kind, color: data.color ?? null, isSystem: false,
  });

  log.adminAction(ctx.userId, 'leads_create_stage', 'lead_pipeline_stage', key);
  revalidatePath(LEADS_PATH);
  return ok({ key });
}

// ─── updateStage ────────────────────────────────────────────────────────────

const UpdateStageSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(60).optional(),
  color: z.string().regex(COLOR_RE).nullable().optional(),
  archived: z.boolean().optional(),
});

export type UpdateStageInput = z.infer<typeof UpdateStageSchema>;

export async function updateStage(input: UpdateStageInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_update_stage');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateStageSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const rows = await db.select().from(leadPipelineStages)
    .where(and(eq(leadPipelineStages.id, data.id), eq(leadPipelineStages.orgId, ctx.orgId))).limit(1);
  const stage = rows[0];
  if (!stage) return Errors.NOT_FOUND();

  if (data.archived === true && stage.isSystem && (stage.kind === 'won' || stage.kind === 'lost')) {
    return Errors.FORBIDDEN();
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.label !== undefined) updates.label = data.label;
  if (data.color !== undefined) updates.color = data.color;
  if (data.archived !== undefined) updates.archived = data.archived;

  await db.update(leadPipelineStages).set(updates)
    .where(and(eq(leadPipelineStages.id, data.id), eq(leadPipelineStages.orgId, ctx.orgId)));

  log.adminAction(ctx.userId, 'leads_update_stage', 'lead_pipeline_stage', data.id);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── reorderStages ──────────────────────────────────────────────────────────

const ReorderStagesSchema = z.object({
  pipeline: z.enum(PIPELINES),
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type ReorderStagesInput = z.infer<typeof ReorderStagesSchema>;

export async function reorderStages(input: ReorderStagesInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_reorder_stages');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ReorderStagesSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const existing = await getPipelineStages(ctx.orgId, data.pipeline, { includeArchived: true });
  const existingIds = new Set(existing.map((s) => s.id));
  const orderedSet = new Set(data.orderedIds);
  const sameSet = existingIds.size === orderedSet.size && [...existingIds].every((id) => orderedSet.has(id));
  if (!sameSet) return Errors.VALIDATION_ERROR({ formErrors: ['El orden no coincide con las etapas actuales'], fieldErrors: {} });

  await db.transaction(async (tx) => {
    for (let i = 0; i < data.orderedIds.length; i++) {
      await tx.update(leadPipelineStages).set({ position: i, updatedAt: new Date() })
        .where(and(eq(leadPipelineStages.id, data.orderedIds[i]), eq(leadPipelineStages.orgId, ctx.orgId)));
    }
  });

  log.adminAction(ctx.userId, 'leads_reorder_stages', 'lead_pipeline_stage', data.pipeline);
  revalidatePath(LEADS_PATH);
  return ok(null);
}

// ─── deleteStage ────────────────────────────────────────────────────────────

const DeleteStageSchema = z.object({
  id: z.string().uuid(),
  moveLeadsTo: z.string().regex(STAGE_KEY_RE),
});

export type DeleteStageInput = z.infer<typeof DeleteStageSchema>;

export async function deleteStage(input: DeleteStageInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'leads_delete_stage');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = DeleteStageSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const rows = await db.select().from(leadPipelineStages)
    .where(and(eq(leadPipelineStages.id, data.id), eq(leadPipelineStages.orgId, ctx.orgId))).limit(1);
  const stage = rows[0];
  if (!stage) return Errors.NOT_FOUND();
  if (stage.isSystem) return Errors.FORBIDDEN();

  const target = await getStage(ctx.orgId, stage.pipeline as Pipeline, data.moveLeadsTo);
  if (!target || target.archived || target.key === stage.key) {
    return Errors.VALIDATION_ERROR({ formErrors: ['La etapa destino no es válida'], fieldErrors: {} });
  }

  await db.transaction(async (tx) => {
    await tx.update(crmLeads).set({ stage: data.moveLeadsTo, stageChangedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(crmLeads.orgId, ctx.orgId), eq(crmLeads.pipeline, stage.pipeline), eq(crmLeads.stage, stage.key)));
    await tx.delete(leadPipelineStages).where(and(eq(leadPipelineStages.id, data.id), eq(leadPipelineStages.orgId, ctx.orgId)));
  });

  log.adminAction(ctx.userId, 'leads_delete_stage', 'lead_pipeline_stage', data.id);
  revalidatePath(LEADS_PATH);
  return ok(null);
}
