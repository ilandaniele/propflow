'use server';

/**
 * Server Actions for the advisor's own Google Calendar connection and for
 * resolving drift flagged by the sync engine (item B) on their visits.
 *
 * All four actions are scoped to the caller's own profile (assumption 5 —
 * one connection per advisor, only the advisor connects their own
 * calendar). resolveCalendarDrift additionally re-checks the visit's org
 * before calling into the service layer.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { enqueueJob } from '@/lib/agent/jobs';
import {
  disconnectConnection,
  getConnectionForProfile,
  updateConnectionSettings,
} from '@/lib/calendar/connections';
import { resolveVisitDrift } from '@/lib/calendar/sync';
import { CALENDAR_JOB_KINDS } from '@/lib/calendar/types';

const AVAILABILITY_PATH = '/dashboard/visits/availability';
const VISITS_PATH = '/dashboard/visits';

// ─── disconnectCalendar ─────────────────────────────────────────────────────

export async function disconnectCalendar(): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'calendar_disconnect');
  if (!rl.success) return Errors.RATE_LIMITED();

  await disconnectConnection(ctx.orgId, ctx.profile.id);

  log.adminAction(ctx.userId, 'calendar_disconnect', 'calendar_connection', ctx.profile.id);
  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}

// ─── updateCalendarSettings ─────────────────────────────────────────────────

const UpdateCalendarSettingsSchema = z.object({
  freebusyEnabled: z.boolean().optional(),
  writeEvents: z.boolean().optional(),
});

export type UpdateCalendarSettingsInput = z.infer<typeof UpdateCalendarSettingsSchema>;

export async function updateCalendarSettings(input: UpdateCalendarSettingsInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'calendar_settings');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateCalendarSettingsSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await updateConnectionSettings(ctx.orgId, ctx.profile.id, parsed.data);

  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}

// ─── resolveCalendarDrift ────────────────────────────────────────────────────

const ResolveCalendarDriftSchema = z.object({
  visitId: z.string().uuid(),
  keep: z.enum(['propflow', 'google']),
});

export type ResolveCalendarDriftInput = z.infer<typeof ResolveCalendarDriftSchema>;

export async function resolveCalendarDrift(input: ResolveCalendarDriftInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'calendar_resolve_drift');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ResolveCalendarDriftSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await resolveVisitDrift({
    orgId: ctx.orgId,
    visitId: parsed.data.visitId,
    keep: parsed.data.keep,
    actorProfileId: ctx.profile.id,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        return Errors.NOT_FOUND();
      case 'slot_taken':
        return Errors.CONFLICT('El horario de Google ya está ocupado por otra visita');
      case 'not_drift':
      case 'not_active':
        return Errors.VALIDATION_ERROR({ formErrors: ['Esta visita ya no tiene un conflicto de calendario pendiente'], fieldErrors: {} });
      default:
        return Errors.INTERNAL();
    }
  }

  log.adminAction(ctx.userId, 'calendar_resolve_drift', 'property_visit', parsed.data.visitId);
  revalidatePath(VISITS_PATH);
  return ok(null);
}

// ─── resyncCalendarNow ───────────────────────────────────────────────────────

export async function resyncCalendarNow(): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'calendar_resync');
  if (!rl.success) return Errors.RATE_LIMITED();

  const connection = await getConnectionForProfile(ctx.orgId, ctx.profile.id);
  if (!connection) return Errors.NOT_FOUND();

  await enqueueJob({ orgId: ctx.orgId, kind: CALENDAR_JOB_KINDS.sync, payload: { connectionId: connection.id } });

  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}
