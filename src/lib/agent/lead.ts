/**
 * crm_leads read/write helpers for the agent. Score and intent_tag are
 * ALWAYS recomputed here from computeLeadScore() — a tool can never set them
 * directly (see tools/update-lead-profile.ts).
 */

import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { computeLeadScore, intentTagForScore, type LeadQualificationInput } from './scoring';
import type { AgentAttribution } from './types';

export interface LeadRecord {
  id: string;
  fullName: string;
  phone: string | null;
  operationType: string | null;
  pipeline: string;
  budgetMin: string | null;
  budgetMax: string | null;
  currency: string;
  zones: string[];
  bedroomsMin: number | null;
  moveInDate: string | null;
  timeline: string | null;
  pets: boolean | null;
  score: number;
  intentTag: string | null;
  stage: string;
  doNotContact: boolean;
}

function toLeadRecord(row: typeof crmLeads.$inferSelect): LeadRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    operationType: row.operationType,
    pipeline: row.pipeline,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    currency: row.currency,
    zones: (row.zones as string[]) ?? [],
    bedroomsMin: row.bedroomsMin,
    moveInDate: row.moveInDate,
    timeline: row.timeline,
    pets: row.pets,
    score: row.score,
    intentTag: row.intentTag,
    stage: row.stage,
    doNotContact: row.doNotContact,
  };
}

export async function getLead(orgId: string, leadId: string): Promise<LeadRecord | null> {
  const rows = await db.select().from(crmLeads).where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId))).limit(1);
  return rows[0] ? toLeadRecord(rows[0]) : null;
}

export interface CreateProspectLeadArgs {
  orgId: string;
  fullName: string;
  phone?: string | null;
  sourceChannel: 'whatsapp' | 'web' | 'voice';
  sourceRef?: string | null;
  sourceMeta?: Record<string, unknown>;
  pipeline?: 'demand' | 'supply';
  operationType?: string | null;
  zones?: string[];
  notes?: string | null;
}

export async function createProspectLead(args: CreateProspectLeadArgs): Promise<LeadRecord> {
  const rows = await db
    .insert(crmLeads)
    .values({
      orgId: args.orgId,
      fullName: args.fullName,
      phone: args.phone ?? null,
      pipeline: args.pipeline ?? 'demand',
      operationType: args.operationType ?? null,
      zones: args.zones ?? [],
      notes: args.notes ?? null,
      sourceChannel: args.sourceChannel,
      sourceRef: args.sourceRef ?? null,
      ...(args.sourceMeta !== undefined ? { sourceMeta: args.sourceMeta } : {}),
      source: 'agent',
    })
    .returning();

  return toLeadRecord(rows[0]);
}

/**
 * Pure helper (decision 11 / blueprint §3): turns the session's attribution
 * into the lead's source_ref + source_meta. No attribution => both null/empty.
 */
export function attributionToSource(a: AgentAttribution | null): {
  sourceRef: string | null;
  sourceMeta: Record<string, unknown>;
} {
  if (!a) return { sourceRef: null, sourceMeta: {} };

  const sourceRef =
    a.type === 'ctwa' && a.sourceId
      ? `ctwa:${a.sourceId}`
      : a.type === 'wa_link' && a.refCode
        ? `ref:${a.refCode}`
        : null;

  return { sourceRef, sourceMeta: { ...a } };
}

/** Only these fields are ever accepted from the model. Score/intentTag/stage/assignedProfileId/doNotContact are computed or staff-only. */
export interface LeadQualificationPatch extends LeadQualificationInput {
  fullName?: string;
}

export async function applyLeadQualification(
  orgId: string,
  leadId: string,
  patch: LeadQualificationPatch
): Promise<LeadRecord> {
  const current = await getLead(orgId, leadId);
  if (!current) throw new Error('[agent/lead] lead not found for this org');

  const merged: LeadQualificationInput = {
    operationType: patch.operationType ?? current.operationType,
    zones: patch.zones ?? current.zones,
    budgetMax: patch.budgetMax ?? (current.budgetMax != null ? Number(current.budgetMax) : null),
    bedroomsMin: patch.bedroomsMin ?? current.bedroomsMin,
    moveInDate: patch.moveInDate ?? current.moveInDate,
    timeline: (patch.timeline ?? current.timeline) as LeadQualificationInput['timeline'],
    pets: patch.pets ?? current.pets,
  };

  const score = computeLeadScore(merged);
  const intentTag = intentTagForScore(score);

  const rows = await db
    .update(crmLeads)
    .set({
      ...(patch.fullName ? { fullName: patch.fullName } : {}),
      operationType: merged.operationType ?? null,
      zones: merged.zones ?? [],
      budgetMax: merged.budgetMax != null ? String(merged.budgetMax) : null,
      bedroomsMin: merged.bedroomsMin ?? null,
      moveInDate: merged.moveInDate ?? null,
      timeline: merged.timeline ?? null,
      pets: merged.pets ?? null,
      score,
      intentTag,
      updatedAt: new Date(),
    })
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)))
    .returning();

  return toLeadRecord(rows[0]);
}
