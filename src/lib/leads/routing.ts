/**
 * Round-robin / weighted lead routing (Phase 6, item D). The model never
 * assigns advisors — there is no tool for it; routing is triggered only
 * from createProspectLead() (src/lib/agent/lead.ts) and from the dashboard
 * actions in src/app/actions/lead-routing.ts (item F).
 *
 * Concurrency safety: routeLead() takes a per-org Postgres advisory xact
 * lock (same pattern as visits/service.ts's phone-cap lock) before reading
 * routing members and open-lead counts, so two leads created back-to-back
 * never race onto the same "next" advisor, and the UPDATE ... WHERE
 * assigned_profile_id IS NULL guards against a lost race even without it.
 */

import { db } from '@/lib/db';
import { crmLeads, leadAssignments, leadPipelineStages, leadRoutingMembers, profiles } from '@/lib/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import type { AssignmentMethod, Pipeline, RoutingMember } from './types';
import { notifyAdvisorLeadAssigned } from './notify-advisor';

// Same query-builder surface as `db` (select/insert/update/delete/execute).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown by upsertRoutingMember() when the target profile isn't an org admin — callers map this to FORBIDDEN. */
export class RoutingMemberForbiddenError extends Error {
  constructor(message = '[leads/routing] profile is not an org admin') {
    super(message);
    this.name = 'RoutingMemberForbiddenError';
  }
}

/**
 * Pure. `mode` is 'manual' is handled by the caller (routeLead no-ops before
 * calling this) — pickAssignee only ever runs round_robin or weighted.
 *
 * Eligible = active && (member.pipeline === pipeline || 'both') &&
 * (maxOpenLeads == null || openLeadsByProfile[profileId] < maxOpenLeads).
 *
 * round_robin: fewest recent assignment wins — min lastAssignedAt (null,
 * i.e. never assigned, sorts first) then profileId as a stable tiebreak.
 * weighted: min (assignedCount+1)/weight wins (lower means "more owed" to
 * that member given its weight), then lastAssignedAt, then profileId.
 */
export function pickAssignee(
  members: RoutingMember[],
  mode: 'round_robin' | 'weighted',
  pipeline: Pipeline,
  openLeadsByProfile: Record<string, number>,
): string | null {
  const eligible = members.filter((m) => {
    if (!m.active) return false;
    if (m.pipeline !== pipeline && m.pipeline !== 'both') return false;
    if (m.maxOpenLeads != null && (openLeadsByProfile[m.profileId] ?? 0) >= m.maxOpenLeads) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const lastAssignedRank = (m: RoutingMember) => (m.lastAssignedAt ? m.lastAssignedAt.getTime() : -Infinity);

  if (mode === 'round_robin') {
    return eligible.slice().sort((a, b) => {
      const diff = lastAssignedRank(a) - lastAssignedRank(b);
      return diff !== 0 ? diff : a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0;
    })[0].profileId;
  }

  return eligible.slice().sort((a, b) => {
    const ra = (a.assignedCount + 1) / a.weight;
    const rb = (b.assignedCount + 1) / b.weight;
    if (ra !== rb) return ra - rb;
    const diff = lastAssignedRank(a) - lastAssignedRank(b);
    return diff !== 0 ? diff : a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0;
  })[0].profileId;
}

function toRoutingMember(row: typeof leadRoutingMembers.$inferSelect): RoutingMember {
  return {
    profileId: row.profileId,
    pipeline: row.pipeline as Pipeline | 'both',
    weight: row.weight,
    active: row.active,
    maxOpenLeads: row.maxOpenLeads,
    assignedCount: row.assignedCount,
    lastAssignedAt: row.lastAssignedAt,
  };
}

/** Open leads = assigned to that profile and on a stage whose kind isn't 'won'/'lost' (or unseeded — treated as open). */
async function getOpenLeadCounts(tx: Tx, orgId: string, profileIds: string[]): Promise<Record<string, number>> {
  if (profileIds.length === 0) return {};

  const rows = await tx
    .select({ profileId: crmLeads.assignedProfileId, cnt: sql<number>`count(*)::int` })
    .from(crmLeads)
    .leftJoin(
      leadPipelineStages,
      and(
        eq(leadPipelineStages.orgId, crmLeads.orgId),
        eq(leadPipelineStages.pipeline, crmLeads.pipeline),
        eq(leadPipelineStages.key, crmLeads.stage),
      ),
    )
    .where(and(
      eq(crmLeads.orgId, orgId),
      inArray(crmLeads.assignedProfileId, profileIds),
      sql`(${leadPipelineStages.kind} IS NULL OR ${leadPipelineStages.kind} NOT IN ('won','lost'))`,
    ))
    .groupBy(crmLeads.assignedProfileId);

  const out: Record<string, number> = {};
  for (const r of rows) if (r.profileId) out[r.profileId] = Number(r.cnt);
  return out;
}

export interface RouteLeadArgs {
  orgId: string;
  leadId: string;
}

export interface RouteLeadResult {
  profileId: string | null;
  method: AssignmentMethod | null;
}

/**
 * No-op (profileId:null, method:null) when the lead is already assigned,
 * routing_mode is 'manual', or there is no eligible member.
 */
export async function routeLead(a: RouteLeadArgs): Promise<RouteLeadResult> {
  const config = await getOrCreateAgentConfig(a.orgId);
  if (config.routingMode === 'manual') return { profileId: null, method: null };
  const mode = config.routingMode as 'round_robin' | 'weighted';

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'lead_routing:' + a.orgId}))`);

    const leadRows = await tx
      .select({ id: crmLeads.id, pipeline: crmLeads.pipeline, assignedProfileId: crmLeads.assignedProfileId })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)))
      .limit(1);
    const lead = leadRows[0];
    if (!lead || lead.assignedProfileId) return null;

    const memberRows = await tx
      .select()
      .from(leadRoutingMembers)
      .where(and(eq(leadRoutingMembers.orgId, a.orgId), eq(leadRoutingMembers.active, true)));
    const members = memberRows.map(toRoutingMember);
    if (members.length === 0) return null;

    const openCounts = await getOpenLeadCounts(tx, a.orgId, members.map((m) => m.profileId));

    const profileId = pickAssignee(members, mode, lead.pipeline as Pipeline, openCounts);
    if (!profileId) return null;

    const now = new Date();
    const updated = await tx
      .update(crmLeads)
      .set({ assignedProfileId: profileId, assignedAt: now, updatedAt: now })
      .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId), isNull(crmLeads.assignedProfileId)))
      .returning({ id: crmLeads.id });
    if (updated.length === 0) return null; // lost the race to another writer despite the advisory lock

    await tx
      .update(leadRoutingMembers)
      .set({ assignedCount: sql`${leadRoutingMembers.assignedCount} + 1`, lastAssignedAt: now, updatedAt: now })
      .where(and(eq(leadRoutingMembers.orgId, a.orgId), eq(leadRoutingMembers.profileId, profileId)));

    const method: AssignmentMethod = mode;
    await tx.insert(leadAssignments).values({
      orgId: a.orgId,
      leadId: a.leadId,
      profileId,
      previousProfileId: null,
      method,
    });

    return { profileId, method };
  });

  if (!result) return { profileId: null, method: null };

  await notifyAdvisorLeadAssigned({ orgId: a.orgId, leadId: a.leadId, profileId: result.profileId, method: result.method }).catch(
    (err) => log.warn('[leads/routing] notifyAdvisorLeadAssigned failed', { orgId: a.orgId, err: (err as Error).message }),
  );

  return result;
}

export interface AssignLeadManuallyArgs {
  orgId: string;
  leadId: string;
  profileId: string | null;
  actorProfileId: string;
}

export type AssignLeadManuallyResult = { ok: true } | { ok: false; reason: 'not_found' | 'invalid_profile' };

/** Staff-triggered assignment/unassignment/reassignment (item F's assignLead action). */
export async function assignLeadManually(a: AssignLeadManuallyArgs): Promise<AssignLeadManuallyResult> {
  if (a.profileId) {
    const profRows = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(and(eq(profiles.id, a.profileId), eq(profiles.orgId, a.orgId)))
      .limit(1);
    if (!profRows[0] || profRows[0].role !== 'admin') return { ok: false, reason: 'invalid_profile' };
  }

  const leadRows = await db
    .select({ id: crmLeads.id, assignedProfileId: crmLeads.assignedProfileId })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, reason: 'not_found' };

  const now = new Date();
  await db
    .update(crmLeads)
    .set({ assignedProfileId: a.profileId, assignedAt: a.profileId ? now : null, updatedAt: now })
    .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)));

  const method: AssignmentMethod = lead.assignedProfileId ? 'reassign' : 'manual';
  await db.insert(leadAssignments).values({
    orgId: a.orgId,
    leadId: a.leadId,
    profileId: a.profileId,
    previousProfileId: lead.assignedProfileId,
    method,
    assignedByProfileId: a.actorProfileId,
  });

  if (a.profileId) {
    await notifyAdvisorLeadAssigned({ orgId: a.orgId, leadId: a.leadId, profileId: a.profileId, method }).catch(
      (err) => log.warn('[leads/routing] notifyAdvisorLeadAssigned failed', { orgId: a.orgId, err: (err as Error).message }),
    );
  }

  return { ok: true };
}

export async function listRoutingMembers(orgId: string): Promise<Array<RoutingMember & { fullName: string | null }>> {
  const rows = await db
    .select({
      profileId: leadRoutingMembers.profileId,
      pipeline: leadRoutingMembers.pipeline,
      weight: leadRoutingMembers.weight,
      active: leadRoutingMembers.active,
      maxOpenLeads: leadRoutingMembers.maxOpenLeads,
      assignedCount: leadRoutingMembers.assignedCount,
      lastAssignedAt: leadRoutingMembers.lastAssignedAt,
      fullName: profiles.fullName,
    })
    .from(leadRoutingMembers)
    .leftJoin(profiles, eq(profiles.id, leadRoutingMembers.profileId))
    .where(eq(leadRoutingMembers.orgId, orgId));

  return rows.map((r) => ({
    profileId: r.profileId,
    pipeline: r.pipeline as Pipeline | 'both',
    weight: r.weight,
    active: r.active,
    maxOpenLeads: r.maxOpenLeads,
    assignedCount: r.assignedCount,
    lastAssignedAt: r.lastAssignedAt,
    fullName: r.fullName,
  }));
}

/** Validates profile ∈ org && role='admin'. A weight change resets assigned_count=0 for the whole org (fairness restart). */
export async function upsertRoutingMember(orgId: string, m: Omit<RoutingMember, 'assignedCount' | 'lastAssignedAt'>): Promise<void> {
  const profRows = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.id, m.profileId), eq(profiles.orgId, orgId)))
    .limit(1);
  if (!profRows[0] || profRows[0].role !== 'admin') {
    throw new RoutingMemberForbiddenError();
  }

  const existingRows = await db
    .select({ weight: leadRoutingMembers.weight })
    .from(leadRoutingMembers)
    .where(and(eq(leadRoutingMembers.orgId, orgId), eq(leadRoutingMembers.profileId, m.profileId)))
    .limit(1);
  const weightChanged = existingRows[0] !== undefined && existingRows[0].weight !== m.weight;

  await db
    .insert(leadRoutingMembers)
    .values({
      orgId,
      profileId: m.profileId,
      pipeline: m.pipeline,
      weight: m.weight,
      active: m.active,
      maxOpenLeads: m.maxOpenLeads,
    })
    .onConflictDoUpdate({
      target: [leadRoutingMembers.orgId, leadRoutingMembers.profileId],
      set: { pipeline: m.pipeline, weight: m.weight, active: m.active, maxOpenLeads: m.maxOpenLeads, updatedAt: new Date() },
    });

  if (weightChanged) {
    await db
      .update(leadRoutingMembers)
      .set({ assignedCount: 0, updatedAt: new Date() })
      .where(eq(leadRoutingMembers.orgId, orgId));
  }
}

export async function removeRoutingMember(orgId: string, profileId: string): Promise<void> {
  await db.delete(leadRoutingMembers).where(and(eq(leadRoutingMembers.orgId, orgId), eq(leadRoutingMembers.profileId, profileId)));
}
