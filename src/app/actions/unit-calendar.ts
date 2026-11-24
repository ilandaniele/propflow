'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { createUnitCalendar, getUnitCalendar, setUnitCalendarImportUrl, unitBelongsToOrg } from '@/lib/unit-calendar/queries';
import { UnitCalendarImportSchema, UnitCalendarSchema } from '@/lib/unit-calendar/schemas';
import { syncUnitCalendar } from '@/lib/unit-calendar/sync';

const calendarPath = (unitId: string) => `/dashboard/units/${unitId}/calendar`;

export async function enableUnitCalendar(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'enable-unit-calendar').success) return Errors.RATE_LIMITED();

  const parsed = UnitCalendarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { unit_id: unitId } = parsed.data;

  if (!(await unitBelongsToOrg(ctx.orgId, unitId))) return Errors.NOT_FOUND();
  await createUnitCalendar(ctx.orgId, unitId);

  log.adminAction(ctx.userId, 'enable_unit_calendar', 'unit', unitId);
  revalidatePath(calendarPath(unitId));
  return ok(undefined);
}

export async function saveUnitCalendarImport(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'save-unit-calendar-import').success) return Errors.RATE_LIMITED();

  const parsed = UnitCalendarImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { unit_id: unitId, import_url: importUrl } = parsed.data;

  const calendar = await setUnitCalendarImportUrl(ctx.orgId, unitId, importUrl);
  if (!calendar) return Errors.NOT_FOUND();
  if (importUrl) await syncUnitCalendar(calendar);

  log.adminAction(ctx.userId, 'save_unit_calendar_import', 'unit', unitId);
  revalidatePath(calendarPath(unitId));
  return ok(undefined);
}

export async function syncUnitCalendarNow(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'sync-unit-calendar').success) return Errors.RATE_LIMITED();

  const parsed = UnitCalendarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { unit_id: unitId } = parsed.data;

  const calendar = await getUnitCalendar(ctx.orgId, unitId);
  if (!calendar?.importUrl) return Errors.NOT_FOUND();
  await syncUnitCalendar(calendar);

  log.adminAction(ctx.userId, 'sync_unit_calendar', 'unit', unitId);
  revalidatePath(calendarPath(unitId));
  return ok(undefined);
}
