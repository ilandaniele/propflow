/**
 * The only write path for property_visits — B (agent tools), C (reminder
 * jobs / button replies) and D (dashboard actions) all go through this
 * module instead of touching Drizzle directly.
 */

import { db } from '@/lib/db';
import { toE164 } from '@/lib/whatsapp/phone';
import {
  agentAdvisorSettings,
  agentJobs,
  crmLeads,
  listings,
  notificationInbox,
  profiles,
  propertyVisits,
} from '@/lib/db/schema';
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { planVisitJobs, VISIT_JOB_KINDS, type VisitJobPayload } from './job-plan';
import { notifyVisitChanged } from './hooks';
import { ACTIVE_VISIT_STATUSES, MAX_ACTIVE_VISITS_PER_PHONE, type VisitFeedback, type VisitRecord, type VisitStatus } from './types';

const ACTIVE_STATUSES: string[] = [...ACTIVE_VISIT_STATUSES];

// The transaction handle db.transaction() passes to its callback — same
// query builder surface as `db` itself (select/insert/update/execute).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BookFailure = 'slot_taken' | 'cap_reached' | 'listing_unavailable' | 'advisor_invalid' | 'in_past' | 'lead_not_found';
export type BookVisitResult = { ok: true; visit: VisitRecord } | { ok: false; reason: BookFailure };

export interface BookVisitArgs {
  orgId: string;
  leadId: string;
  listingId: string | null;
  profileId: string;
  startsAt: Date;
  visitMinutes: number;
  bufferMinutes?: number;
  contactPhone: string | null;
  createdBy: 'agent' | 'human';
  createdByProfileId?: string | null;
  sourceChannel: 'whatsapp' | 'web' | 'voice' | 'manual';
  sessionId?: string | null;
  notes?: string | null;
  requirePublishedListing?: boolean;
  enforcePhoneCap?: boolean;
}

function toVisitRecord(
  row: typeof propertyVisits.$inferSelect,
  extra?: { listingTitle?: string | null; advisorName?: string | null; leadName?: string | null },
): VisitRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    leadId: row.leadId,
    listingId: row.listingId,
    profileId: row.profileId,
    sessionId: row.sessionId,
    contactPhone: row.contactPhone,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    blockedUntil: row.blockedUntil,
    status: row.status as VisitStatus,
    createdBy: row.createdBy as 'agent' | 'human',
    sourceChannel: row.sourceChannel as VisitRecord['sourceChannel'],
    rescheduledFromId: row.rescheduledFromId,
    feedback: row.feedback as VisitFeedback | null,
    notes: row.notes,
    listingTitle: extra?.listingTitle ?? null,
    advisorName: extra?.advisorName ?? null,
    leadName: extra?.leadName ?? null,
  };
}

/**
 * Thrown inside rescheduleVisit's transaction when bookVisitInTx returns a
 * soft failure (e.g. cap_reached) after the old visit was already marked
 * 'rescheduled' — rolls the whole transaction back so the old visit stays
 * active instead of committing an orphaned reschedule. Unwrapped in the
 * catch next to isExclusionViolation.
 */
class RescheduleFailed extends Error {
  constructor(public readonly reason: BookFailure) {
    super(`[agent/visits/service] reschedule failed: ${reason}`);
  }
}

/** code === '23P01' on the error itself or on e.cause (DrizzleQueryError wraps the driver error). */
export function isExclusionViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if ((e as { code?: unknown }).code === '23P01') return true;
  const cause = (e as { cause?: unknown }).cause;
  return !!cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23P01';
}

/** Steps 2-9 of bookVisit (blueprint §2.8) — shared with rescheduleVisit, which runs them in its own transaction. Never catches 23P01: the caller's transaction must roll back. */
async function bookVisitInTx(tx: Tx, a: BookVisitArgs, now: Date): Promise<BookVisitResult> {
  if (a.startsAt < now) return { ok: false, reason: 'in_past' };

  const contactPhone = a.contactPhone ? toE164(a.contactPhone) : null;

  const leadRows = await tx
    .select({ id: crmLeads.id, stage: crmLeads.stage, assignedProfileId: crmLeads.assignedProfileId })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, reason: 'lead_not_found' };

  const advisorRows = await tx
    .select({
      role: profiles.role,
      acceptsVisits: agentAdvisorSettings.acceptsVisits,
      bufferMinutes: agentAdvisorSettings.bufferMinutes,
    })
    .from(profiles)
    .leftJoin(agentAdvisorSettings, and(eq(agentAdvisorSettings.profileId, profiles.id), eq(agentAdvisorSettings.orgId, a.orgId)))
    .where(and(eq(profiles.id, a.profileId), eq(profiles.orgId, a.orgId)))
    .limit(1);
  const advisor = advisorRows[0];
  if (!advisor || advisor.role !== 'admin' || !advisor.acceptsVisits) return { ok: false, reason: 'advisor_invalid' };

  if (a.listingId) {
    const listingConditions = [eq(listings.id, a.listingId), eq(listings.orgId, a.orgId)];
    if (a.requirePublishedListing) {
      listingConditions.push(eq(listings.published, true));
      listingConditions.push(eq(listings.status, 'available'));
    }
    const listingRows = await tx.select({ id: listings.id }).from(listings).where(and(...listingConditions)).limit(1);
    if (!listingRows[0]) return { ok: false, reason: 'listing_unavailable' };
  }

  if (a.enforcePhoneCap && contactPhone) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${a.orgId + ':' + contactPhone}))`);
    const activeRows = await tx
      .select({ id: propertyVisits.id })
      .from(propertyVisits)
      .where(and(
        eq(propertyVisits.orgId, a.orgId),
        eq(propertyVisits.contactPhone, contactPhone),
        inArray(propertyVisits.status, ACTIVE_STATUSES),
        gte(propertyVisits.startsAt, now),
      ));
    if (activeRows.length >= MAX_ACTIVE_VISITS_PER_PHONE) return { ok: false, reason: 'cap_reached' };
  }

  const bufferMinutes = a.bufferMinutes ?? advisor.bufferMinutes ?? 15;
  const endsAt = new Date(a.startsAt.getTime() + a.visitMinutes * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + bufferMinutes * 60_000);

  const inserted = await tx
    .insert(propertyVisits)
    .values({
      orgId: a.orgId,
      leadId: a.leadId,
      listingId: a.listingId,
      profileId: a.profileId,
      sessionId: a.sessionId ?? null,
      contactPhone,
      startsAt: a.startsAt,
      endsAt,
      blockedUntil,
      createdBy: a.createdBy,
      createdByProfileId: a.createdByProfileId ?? null,
      sourceChannel: a.sourceChannel,
      notes: a.notes ?? null,
    })
    .returning();
  const row = inserted[0];

  const jobs = planVisitJobs({ startsAt: a.startsAt, endsAt }, now);
  if (jobs.length > 0) {
    await tx.insert(agentJobs).values(
      jobs.map((j) => ({
        orgId: a.orgId,
        kind: j.kind,
        runAt: j.runAt,
        payload: { visitId: row.id, startsAt: a.startsAt.toISOString() } satisfies VisitJobPayload,
      })),
    );
  }

  const leadPatch: Record<string, unknown> = {};
  if (['new', 'contacted', 'qualified'].includes(lead.stage)) leadPatch.stage = 'visit_scheduled';
  if (!lead.assignedProfileId) leadPatch.assignedProfileId = a.profileId;
  if (Object.keys(leadPatch).length > 0) {
    await tx.update(crmLeads).set({ ...leadPatch, updatedAt: now }).where(eq(crmLeads.id, a.leadId));
  }

  await tx.insert(notificationInbox).values({
    orgId: a.orgId,
    profileId: a.profileId,
    type: 'visit_booked',
    title: 'Nueva visita agendada',
    body: `Se agendó una visita para el ${a.startsAt.toISOString()}.`,
    relatedType: 'property_visit',
    relatedId: row.id,
  });

  return { ok: true, visit: toVisitRecord(row) };
}

export async function bookVisit(a: BookVisitArgs): Promise<BookVisitResult> {
  const now = new Date();

  try {
    const result = await db.transaction((tx) => bookVisitInTx(tx, a, now));
    if (result.ok) notifyVisitChanged({ orgId: a.orgId, visitId: result.visit.id, profileId: result.visit.profileId, kind: 'created' });
    return result;
  } catch (e) {
    if (isExclusionViolation(e)) return { ok: false, reason: 'slot_taken' };
    throw e;
  }
}

export interface RescheduleVisitArgs {
  orgId: string;
  visitId: string;
  leadId: string | null; // null = staff (no lead-ownership filter)
  newStartsAt: Date;
  visitMinutes?: number;
  profileId?: string;
  actor: 'agent' | 'human' | 'lead_button';
  actorProfileId?: string | null;
  sessionId?: string | null;
}

export async function rescheduleVisit(
  a: RescheduleVisitArgs,
): Promise<BookVisitResult | { ok: false; reason: 'not_found' | 'not_active' }> {
  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      // Atomic claim: UPDATE ... WHERE status IN (active) RETURNING * doubles
      // as the row lock and the active-status check — no separate SELECT that
      // could race with a concurrent cancel/reschedule of the same visit.
      const lockConditions = [
        eq(propertyVisits.id, a.visitId),
        eq(propertyVisits.orgId, a.orgId),
        inArray(propertyVisits.status, ACTIVE_STATUSES),
      ];
      if (a.leadId) lockConditions.push(eq(propertyVisits.leadId, a.leadId));

      const lockedRows = await tx
        .update(propertyVisits)
        .set({ status: 'rescheduled', updatedAt: now })
        .where(and(...lockConditions))
        .returning();
      const old = lockedRows[0];
      if (!old) return { ok: false as const, reason: 'not_active' as const };

      const bookArgs: BookVisitArgs = {
        orgId: a.orgId,
        leadId: old.leadId,
        listingId: old.listingId,
        profileId: a.profileId ?? old.profileId,
        startsAt: a.newStartsAt,
        visitMinutes: a.visitMinutes ?? Math.round((old.endsAt.getTime() - old.startsAt.getTime()) / 60_000),
        contactPhone: old.contactPhone,
        createdBy: a.actor === 'human' ? 'human' : 'agent',
        createdByProfileId: a.actorProfileId ?? null,
        sourceChannel: old.sourceChannel as BookVisitArgs['sourceChannel'],
        sessionId: a.sessionId ?? old.sessionId,
        notes: old.notes,
        requirePublishedListing: false,
        enforcePhoneCap: false,
      };

      const result = await bookVisitInTx(tx, bookArgs, now);
      // A soft failure here must not commit — the old visit was already set
      // to 'rescheduled' above, so returning `result` as-is would leave it
      // rescheduled with no replacement booked. Throw so the transaction
      // rolls the old visit back to its original status.
      if (!result.ok) throw new RescheduleFailed(result.reason);

      await tx.update(propertyVisits).set({ rescheduledFromId: old.id, updatedAt: now }).where(eq(propertyVisits.id, result.visit.id));

      return { ok: true as const, visit: { ...result.visit, rescheduledFromId: old.id }, oldProfileId: old.profileId };
    });
    if (result.ok) {
      notifyVisitChanged({ orgId: a.orgId, visitId: a.visitId, profileId: result.oldProfileId, kind: 'rescheduled_from' });
      notifyVisitChanged({ orgId: a.orgId, visitId: result.visit.id, profileId: result.visit.profileId, kind: 'rescheduled_to' });
      return { ok: true, visit: result.visit };
    }
    return result;
  } catch (e) {
    if (e instanceof RescheduleFailed) return { ok: false, reason: e.reason };
    if (isExclusionViolation(e)) return { ok: false, reason: 'slot_taken' };
    throw e;
  }
}

export interface CancelVisitArgs {
  orgId: string;
  visitId: string;
  leadId: string | null;
  reason?: string | null;
  actor: 'agent' | 'human' | 'lead_button';
}

export async function cancelVisit(a: CancelVisitArgs): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_active' }> {
  const conditions = [eq(propertyVisits.id, a.visitId), eq(propertyVisits.orgId, a.orgId)];
  if (a.leadId) conditions.push(eq(propertyVisits.leadId, a.leadId));

  const rows = await db.select({ id: propertyVisits.id, status: propertyVisits.status, profileId: propertyVisits.profileId }).from(propertyVisits).where(and(...conditions)).limit(1);
  const visit = rows[0];
  if (!visit) return { ok: false, reason: 'not_found' };
  if (!ACTIVE_STATUSES.includes(visit.status)) return { ok: false, reason: 'not_active' };

  await db
    .update(propertyVisits)
    .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: a.reason ?? null, updatedAt: new Date() })
    .where(eq(propertyVisits.id, visit.id));

  notifyVisitChanged({ orgId: a.orgId, visitId: visit.id, profileId: visit.profileId, kind: 'cancelled' });
  return { ok: true };
}

/** scheduled -> confirmed. Idempotent — calling it again on an already-confirmed visit is a no-op success. */
export async function confirmVisit(orgId: string, visitId: string): Promise<VisitRecord | null> {
  const rows = await db.select().from(propertyVisits).where(and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId))).limit(1);
  const visit = rows[0];
  if (!visit) return null;
  if (visit.status !== 'scheduled') return toVisitRecord(visit);

  const updated = await db
    .update(propertyVisits)
    .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(propertyVisits.id, visitId))
    .returning();

  notifyVisitChanged({ orgId, visitId: updated[0].id, profileId: updated[0].profileId, kind: 'status' });
  return toVisitRecord(updated[0]);
}

export interface MarkVisitOutcomeArgs {
  orgId: string;
  visitId: string;
  outcome: 'completed' | 'no_show';
  source: 'staff' | 'lead';
  actorProfileId?: string | null;
}

const OUTCOME_ELIGIBLE_STATUSES: string[] = ['scheduled', 'confirmed'];

/** Atomic claim + guard: only a scheduled/confirmed visit whose time has already passed can have its outcome recorded. Anything else (already marked, cancelled, rescheduled, or still in the future) returns null — the caller surfaces this as an error rather than silently overwriting an outcome. */
export async function markVisitOutcome(a: MarkVisitOutcomeArgs): Promise<VisitRecord | null> {
  const visit = await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(propertyVisits)
      .set({ status: a.outcome, completedAt: now, outcomeSource: a.source, updatedAt: now })
      .where(and(
        eq(propertyVisits.id, a.visitId),
        eq(propertyVisits.orgId, a.orgId),
        inArray(propertyVisits.status, OUTCOME_ELIGIBLE_STATUSES),
        lte(propertyVisits.startsAt, now),
      ))
      .returning();
    const visit = updated[0];
    if (!visit) return null;

    if (a.outcome === 'completed') {
      const leadRows = await tx.select({ stage: crmLeads.stage }).from(crmLeads).where(eq(crmLeads.id, visit.leadId)).limit(1);
      if (leadRows[0]?.stage === 'visit_scheduled') {
        await tx.update(crmLeads).set({ stage: 'visited', updatedAt: now }).where(eq(crmLeads.id, visit.leadId));
      }
    }

    if (!visit.postCheckSentAt) {
      await tx.insert(agentJobs).values({
        orgId: a.orgId,
        kind: VISIT_JOB_KINDS.postCheck,
        runAt: now,
        payload: { visitId: visit.id, startsAt: visit.startsAt.toISOString() } satisfies VisitJobPayload,
      });
    }

    return visit;
  });
  if (!visit) return null;

  notifyVisitChanged({ orgId: a.orgId, visitId: visit.id, profileId: visit.profileId, kind: 'status' });
  return toVisitRecord(visit);
}

export async function recordVisitFeedback(orgId: string, visitId: string, f: VisitFeedback): Promise<VisitRecord | null> {
  const rows = await db
    .update(propertyVisits)
    .set({ feedback: f, updatedAt: new Date() })
    .where(and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId)))
    .returning();
  return rows[0] ? toVisitRecord(rows[0]) : null;
}

/** Shared read path — always joins for display fields (listingTitle/advisorName/leadName). */
async function queryVisits(where: SQL<unknown>): Promise<VisitRecord[]> {
  const rows = await db
    .select({
      visit: propertyVisits,
      listingTitle: listings.title,
      advisorName: profiles.fullName,
      leadName: crmLeads.fullName,
    })
    .from(propertyVisits)
    .leftJoin(listings, eq(listings.id, propertyVisits.listingId))
    .leftJoin(profiles, eq(profiles.id, propertyVisits.profileId))
    .leftJoin(crmLeads, eq(crmLeads.id, propertyVisits.leadId))
    .where(where)
    .orderBy(asc(propertyVisits.startsAt));

  return rows.map((r) => toVisitRecord(r.visit, { listingTitle: r.listingTitle, advisorName: r.advisorName, leadName: r.leadName }));
}

export async function getVisit(orgId: string, visitId: string): Promise<VisitRecord | null> {
  const where = and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId));
  const rows = await queryVisits(where as SQL<unknown>);
  return rows[0] ?? null;
}

export async function listLeadActiveVisits(orgId: string, leadId: string): Promise<VisitRecord[]> {
  const where = and(eq(propertyVisits.orgId, orgId), eq(propertyVisits.leadId, leadId), inArray(propertyVisits.status, ACTIVE_STATUSES));
  return queryVisits(where as SQL<unknown>);
}

export async function findNextActiveVisitByPhone(orgId: string, phone: string, withinHours = 72): Promise<VisitRecord | null> {
  const now = new Date();
  const from = new Date(now.getTime() - withinHours * 60 * 60 * 1000);
  const to = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

  const where = and(
    eq(propertyVisits.orgId, orgId),
    eq(propertyVisits.contactPhone, phone),
    inArray(propertyVisits.status, [...ACTIVE_STATUSES, 'completed', 'no_show']),
    gte(propertyVisits.startsAt, from),
    lt(propertyVisits.startsAt, to),
  );
  const rows = await queryVisits(where as SQL<unknown>);
  if (rows.length === 0) return null;

  rows.sort((a, b) => Math.abs(a.startsAt.getTime() - now.getTime()) - Math.abs(b.startsAt.getTime() - now.getTime()));
  return rows[0];
}

export async function listVisitsInRange(orgId: string, from: Date, to: Date, profileId?: string): Promise<VisitRecord[]> {
  const conditions = [eq(propertyVisits.orgId, orgId), gte(propertyVisits.startsAt, from), lt(propertyVisits.startsAt, to)];
  if (profileId) conditions.push(eq(propertyVisits.profileId, profileId));
  return queryVisits(and(...conditions) as SQL<unknown>);
}

type VisitFlag = 'reminder_24h_sent_at' | 'reminder_2h_sent_at' | 'advisor_reminded_at' | 'post_check_sent_at' | 'feedback_requested_at' | 'reoffer_sent_at';

const FLAG_COLUMNS = {
  reminder_24h_sent_at: propertyVisits.reminder24hSentAt,
  reminder_2h_sent_at: propertyVisits.reminder2hSentAt,
  advisor_reminded_at: propertyVisits.advisorRemindedAt,
  post_check_sent_at: propertyVisits.postCheckSentAt,
  feedback_requested_at: propertyVisits.feedbackRequestedAt,
  reoffer_sent_at: propertyVisits.reofferSentAt,
} as const;

function flagSetPatch(flag: VisitFlag, value: Date | null): Record<string, Date | null> {
  switch (flag) {
    case 'reminder_24h_sent_at': return { reminder24hSentAt: value };
    case 'reminder_2h_sent_at': return { reminder2hSentAt: value };
    case 'advisor_reminded_at': return { advisorRemindedAt: value };
    case 'post_check_sent_at': return { postCheckSentAt: value };
    case 'feedback_requested_at': return { feedbackRequestedAt: value };
    case 'reoffer_sent_at': return { reofferSentAt: value };
  }
}

/** UPDATE ... WHERE flag IS NULL AND guard RETURNING — the atomic claim reminder/post-visit jobs use to avoid double-sending. */
export async function claimVisitFlag(
  orgId: string,
  visitId: string,
  flag: VisitFlag,
  guard: { startsAtIso?: string; statuses?: VisitStatus[] },
): Promise<VisitRecord | null> {
  const conditions = [eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId), isNull(FLAG_COLUMNS[flag])];
  if (guard.startsAtIso) conditions.push(eq(propertyVisits.startsAt, new Date(guard.startsAtIso)));
  if (guard.statuses && guard.statuses.length > 0) conditions.push(inArray(propertyVisits.status, guard.statuses));

  const rows = await db
    .update(propertyVisits)
    .set({ ...flagSetPatch(flag, new Date()), updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return rows[0] ? toVisitRecord(rows[0]) : null;
}

/** Puts the flag back to NULL — called when the send that the claim was for actually failed, so a retry can claim it again. */
export async function releaseVisitFlag(orgId: string, visitId: string, flag: string): Promise<void> {
  const patch = flagSetPatch(flag as VisitFlag, null);
  await db
    .update(propertyVisits)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId)));
}
