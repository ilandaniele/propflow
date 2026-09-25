'use server';

/**
 * Staff-facing visit-scheduling actions for the /dashboard/visits UI —
 * createVisitManual/rescheduleVisitStaff/cancelVisitStaff/
 * markVisitOutcomeAction/confirmVisitStaff.
 *
 * All writes go through src/lib/agent/visits/service.ts — the single write
 * path for property_visits shared with the agent tools (item B) and the
 * reminder jobs (item C). This file only translates staff input (local
 * wall-clock date + minute) into UTC and staff errors into ActionResult.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { zonedWallTimeToUtc } from '@/lib/agent/visits/slots';
import {
  bookVisit,
  cancelVisit,
  confirmVisit,
  markVisitOutcome,
  rescheduleVisit,
  type BookFailure,
} from '@/lib/agent/visits/service';
import type { ActionResult } from '@/lib/errors';

const VISITS_PATH = '/dashboard/visits';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_VISIT_MINUTES = 45;

/** Maps the service layer's typed failure reasons onto ActionResult error codes. */
function mapBookFailure(reason: BookFailure) {
  switch (reason) {
    case 'slot_taken':
      return Errors.CONFLICT('Ese horario ya está ocupado para este asesor');
    case 'cap_reached':
      return Errors.CONFLICT('Este contacto ya tiene el máximo de visitas activas');
    case 'lead_not_found':
      return Errors.NOT_FOUND();
    case 'listing_unavailable':
      return Errors.VALIDATION_ERROR({ formErrors: ['La propiedad seleccionada no está disponible'], fieldErrors: {} });
    case 'advisor_invalid':
      return Errors.VALIDATION_ERROR({ formErrors: ['El asesor seleccionado no acepta visitas'], fieldErrors: {} });
    case 'in_past':
      return Errors.VALIDATION_ERROR({ formErrors: ['El horario elegido ya pasó'], fieldErrors: {} });
    default:
      return Errors.INTERNAL();
  }
}

/** date is local 'YYYY-MM-DD' in the org's timezone; startMinute is minutes since local midnight. */
function toUtc(date: string, startMinute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return zonedWallTimeToUtc(y, m, d, startMinute, timeZone);
}

// ─── createVisitManual ──────────────────────────────────────────────────────

const NewLeadSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
});

const CreateVisitManualSchema = z
  .object({
    leadId: z.string().uuid().optional(),
    newLead: NewLeadSchema.optional(),
    listingId: z.string().uuid().nullable().optional(),
    profileId: z.string().uuid(),
    date: z.string().regex(DATE_RE),
    startMinute: z.number().int().min(0).max(1439),
    visitMinutes: z.number().int().min(10).max(240).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Boolean(v.leadId) !== Boolean(v.newLead), {
    message: 'Provide either leadId or newLead, not both',
  });

export type CreateVisitManualInput = z.infer<typeof CreateVisitManualSchema>;

export async function createVisitManual(input: CreateVisitManualInput): Promise<ActionResult<{ visitId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visits_create');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreateVisitManualSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  // Resolve the lead: an existing one (org-scoped, IDOR-safe) or a fresh
  // prospect created directly here (item D deliberately does not touch
  // lib/agent/lead.ts — see blueprint §6).
  let leadId: string;
  let contactPhone: string | null;
  if (data.leadId) {
    const rows = await db
      .select({ id: crmLeads.id, phone: crmLeads.phone })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, data.leadId), eq(crmLeads.orgId, ctx.orgId)))
      .limit(1);
    if (!rows[0]) return Errors.NOT_FOUND();
    leadId = rows[0].id;
    contactPhone = rows[0].phone;
  } else {
    const inserted = await db
      .insert(crmLeads)
      .values({
        orgId: ctx.orgId,
        fullName: data.newLead!.fullName,
        phone: data.newLead!.phone ?? null,
        sourceChannel: 'manual',
        source: 'manual',
      })
      .returning({ id: crmLeads.id, phone: crmLeads.phone });
    leadId = inserted[0].id;
    contactPhone = inserted[0].phone;
  }

  const config = await getOrCreateAgentConfig(ctx.orgId);
  const startsAt = toUtc(data.date, data.startMinute, config.timezone);

  const result = await bookVisit({
    orgId: ctx.orgId,
    leadId,
    listingId: data.listingId ?? null,
    profileId: data.profileId,
    startsAt,
    visitMinutes: data.visitMinutes ?? DEFAULT_VISIT_MINUTES,
    contactPhone,
    createdBy: 'human',
    createdByProfileId: ctx.userId,
    sourceChannel: 'manual',
    notes: data.notes ?? null,
    requirePublishedListing: false,
    enforcePhoneCap: false,
  });

  if (!result.ok) return mapBookFailure(result.reason);

  log.adminAction(ctx.userId, 'visits_create', 'property_visit', result.visit.id);
  revalidatePath(VISITS_PATH);
  return ok({ visitId: result.visit.id });
}

// ─── rescheduleVisitStaff ───────────────────────────────────────────────────

const RescheduleVisitStaffSchema = z.object({
  visitId: z.string().uuid(),
  date: z.string().regex(DATE_RE),
  startMinute: z.number().int().min(0).max(1439),
  profileId: z.string().uuid().optional(),
});

export type RescheduleVisitStaffInput = z.infer<typeof RescheduleVisitStaffSchema>;

export async function rescheduleVisitStaff(input: RescheduleVisitStaffInput): Promise<ActionResult<{ visitId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visits_reschedule');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RescheduleVisitStaffSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const config = await getOrCreateAgentConfig(ctx.orgId);
  const newStartsAt = toUtc(data.date, data.startMinute, config.timezone);

  const result = await rescheduleVisit({
    orgId: ctx.orgId,
    visitId: data.visitId,
    leadId: null, // staff — no lead-ownership filter
    newStartsAt,
    profileId: data.profileId,
    actor: 'human',
    actorProfileId: ctx.userId,
  });

  if (!result.ok) {
    if (result.reason === 'not_found' || result.reason === 'not_active') return Errors.NOT_FOUND();
    return mapBookFailure(result.reason);
  }

  log.adminAction(ctx.userId, 'visits_reschedule', 'property_visit', result.visit.id);
  revalidatePath(VISITS_PATH);
  return ok({ visitId: result.visit.id });
}

// ─── cancelVisitStaff ───────────────────────────────────────────────────────

const CancelVisitStaffSchema = z.object({
  visitId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type CancelVisitStaffInput = z.infer<typeof CancelVisitStaffSchema>;

export async function cancelVisitStaff(input: CancelVisitStaffInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visits_cancel');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CancelVisitStaffSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const result = await cancelVisit({
    orgId: ctx.orgId,
    visitId: data.visitId,
    leadId: null,
    reason: data.reason ?? null,
    actor: 'human',
  });

  if (!result.ok) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'visits_cancel', 'property_visit', data.visitId);
  revalidatePath(VISITS_PATH);
  return ok(null);
}

// ─── markVisitOutcomeAction ─────────────────────────────────────────────────

const MarkVisitOutcomeSchema = z.object({
  visitId: z.string().uuid(),
  outcome: z.enum(['completed', 'no_show']),
});

export type MarkVisitOutcomeInput = z.infer<typeof MarkVisitOutcomeSchema>;

export async function markVisitOutcomeAction(input: MarkVisitOutcomeInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visits_mark_outcome');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = MarkVisitOutcomeSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const visit = await markVisitOutcome({
    orgId: ctx.orgId,
    visitId: data.visitId,
    outcome: data.outcome,
    source: 'staff',
    actorProfileId: ctx.userId,
  });

  if (!visit) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'visits_mark_outcome', 'property_visit', data.visitId);
  revalidatePath(VISITS_PATH);
  return ok(null);
}

// ─── confirmVisitStaff ──────────────────────────────────────────────────────

const ConfirmVisitStaffSchema = z.object({ visitId: z.string().uuid() });

export type ConfirmVisitStaffInput = z.infer<typeof ConfirmVisitStaffSchema>;

export async function confirmVisitStaff(input: ConfirmVisitStaffInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visits_confirm');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ConfirmVisitStaffSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const visit = await confirmVisit(ctx.orgId, parsed.data.visitId);
  if (!visit) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'visits_confirm', 'property_visit', parsed.data.visitId);
  revalidatePath(VISITS_PATH);
  return ok(null);
}
