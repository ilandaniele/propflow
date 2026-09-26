'use server';

/**
 * Staff-facing availability configuration for /dashboard/visits/availability
 * — per-advisor booking settings, weekly windows and one-off exceptions.
 * Reads/writes item A's Drizzle tables directly (there is no service.ts
 * entry point for availability config — only for visits themselves).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { agentAdvisorSettings, agentAvailability, agentAvailabilityExceptions, profiles } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { zonedWallTimeToUtc } from '@/lib/agent/visits/slots';
import type { ActionResult } from '@/lib/errors';

const AVAILABILITY_PATH = '/dashboard/visits/availability';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The target profile must belong to this org and be an admin (an advisor). */
async function assertAdvisorProfile(orgId: string, profileId: string): Promise<boolean> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(1);
  return Boolean(rows[0]);
}

// ─── saveAdvisorSettings ────────────────────────────────────────────────────

const SaveAdvisorSettingsSchema = z.object({
  profileId: z.string().uuid(),
  acceptsVisits: z.boolean(),
  visitMinutes: z.number().int().min(10).max(240),
  bufferMinutes: z.number().int().min(0).max(120),
  minNoticeMinutes: z.number().int().min(0),
  daysAhead: z.number().int().min(1).max(60),
  slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
});

export type SaveAdvisorSettingsInput = z.infer<typeof SaveAdvisorSettingsSchema>;

export async function saveAdvisorSettings(input: SaveAdvisorSettingsInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visit_availability_save_settings');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveAdvisorSettingsSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  if (!(await assertAdvisorProfile(ctx.orgId, data.profileId))) return Errors.FORBIDDEN();

  try {
    await db
      .insert(agentAdvisorSettings)
      .values({
        orgId: ctx.orgId,
        profileId: data.profileId,
        acceptsVisits: data.acceptsVisits,
        visitMinutes: data.visitMinutes,
        bufferMinutes: data.bufferMinutes,
        minNoticeMinutes: data.minNoticeMinutes,
        daysAhead: data.daysAhead,
        slotStepMinutes: data.slotStepMinutes,
      })
      .onConflictDoUpdate({
        target: [agentAdvisorSettings.orgId, agentAdvisorSettings.profileId],
        set: {
          acceptsVisits: data.acceptsVisits,
          visitMinutes: data.visitMinutes,
          bufferMinutes: data.bufferMinutes,
          minNoticeMinutes: data.minNoticeMinutes,
          daysAhead: data.daysAhead,
          slotStepMinutes: data.slotStepMinutes,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    log.error('[visit-availability] saveAdvisorSettings db error', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'visit_availability_save_settings', 'agent_advisor_settings', data.profileId);
  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}

// ─── replaceWeeklyWindows ───────────────────────────────────────────────────

const WeeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine((w) => w.endMinute > w.startMinute, { message: 'endMinute must be after startMinute' });

const ReplaceWeeklyWindowsSchema = z.object({
  profileId: z.string().uuid(),
  windows: z.array(WeeklyWindowSchema).max(100),
});

export type ReplaceWeeklyWindowsInput = z.infer<typeof ReplaceWeeklyWindowsSchema>;

/** True if any two windows for the same weekday overlap. */
function hasOverlap(windows: Array<{ weekday: number; startMinute: number; endMinute: number }>): boolean {
  const byWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
  for (const w of windows) {
    if (!byWeekday.has(w.weekday)) byWeekday.set(w.weekday, []);
    byWeekday.get(w.weekday)!.push(w);
  }
  for (const dayWindows of byWeekday.values()) {
    const sorted = [...dayWindows].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startMinute < sorted[i - 1].endMinute) return true;
    }
  }
  return false;
}

export async function replaceWeeklyWindows(input: ReplaceWeeklyWindowsInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visit_availability_replace_windows');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ReplaceWeeklyWindowsSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  if (!(await assertAdvisorProfile(ctx.orgId, data.profileId))) return Errors.FORBIDDEN();

  if (hasOverlap(data.windows)) {
    return Errors.VALIDATION_ERROR({ formErrors: ['Las franjas del mismo día no pueden solaparse'], fieldErrors: {} });
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(agentAvailability)
        .where(and(eq(agentAvailability.orgId, ctx.orgId), eq(agentAvailability.profileId, data.profileId)));

      if (data.windows.length > 0) {
        await tx.insert(agentAvailability).values(
          data.windows.map((w) => ({
            orgId: ctx.orgId,
            profileId: data.profileId,
            weekday: w.weekday,
            startMinute: w.startMinute,
            endMinute: w.endMinute,
          })),
        );
      }
    });
  } catch (e) {
    log.error('[visit-availability] replaceWeeklyWindows db error', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'visit_availability_replace_windows', 'agent_availability', data.profileId);
  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}

// ─── addAvailabilityException ───────────────────────────────────────────────

const AddAvailabilityExceptionSchema = z
  .object({
    profileId: z.string().uuid(),
    date: z.string().regex(DATE_RE),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    kind: z.enum(['block', 'extra']),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.endMinute > v.startMinute, { message: 'endMinute must be after startMinute' });

export type AddAvailabilityExceptionInput = z.infer<typeof AddAvailabilityExceptionSchema>;

export async function addAvailabilityException(input: AddAvailabilityExceptionInput): Promise<ActionResult<{ id: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visit_availability_add_exception');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AddAvailabilityExceptionSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  if (!(await assertAdvisorProfile(ctx.orgId, data.profileId))) return Errors.FORBIDDEN();

  const config = await getOrCreateAgentConfig(ctx.orgId);
  const [y, m, d] = data.date.split('-').map(Number);
  const startsAt = zonedWallTimeToUtc(y, m, d, data.startMinute, config.timezone);
  const endsAt = zonedWallTimeToUtc(y, m, d, data.endMinute, config.timezone);

  let id: string;
  try {
    const rows = await db
      .insert(agentAvailabilityExceptions)
      .values({
        orgId: ctx.orgId,
        profileId: data.profileId,
        startsAt,
        endsAt,
        kind: data.kind,
        reason: data.reason ?? null,
        createdByProfileId: ctx.userId,
      })
      .returning({ id: agentAvailabilityExceptions.id });
    id = rows[0].id;
  } catch (e) {
    log.error('[visit-availability] addAvailabilityException db error', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'visit_availability_add_exception', 'agent_availability_exception', id);
  revalidatePath(AVAILABILITY_PATH);
  return ok({ id });
}

// ─── deleteAvailabilityException ────────────────────────────────────────────

const DeleteAvailabilityExceptionSchema = z.object({ id: z.string().uuid() });

export type DeleteAvailabilityExceptionInput = z.infer<typeof DeleteAvailabilityExceptionSchema>;

export async function deleteAvailabilityException(input: DeleteAvailabilityExceptionInput): Promise<ActionResult<null>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'visit_availability_delete_exception');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = DeleteAvailabilityExceptionSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const rows = await db
    .delete(agentAvailabilityExceptions)
    .where(and(eq(agentAvailabilityExceptions.id, parsed.data.id), eq(agentAvailabilityExceptions.orgId, ctx.orgId)))
    .returning({ id: agentAvailabilityExceptions.id });

  if (!rows[0]) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'visit_availability_delete_exception', 'agent_availability_exception', parsed.data.id);
  revalidatePath(AVAILABILITY_PATH);
  return ok(null);
}
