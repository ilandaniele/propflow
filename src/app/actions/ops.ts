'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import {
  announcements,
  cleaningTasks,
  crmLeads,
  reminders,
  notificationInbox,
  profiles,
  tenants,
  units,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import {
  AnnouncementSchema,
  PublishAnnouncementSchema,
  CleaningTaskSchema,
  UpdateCleaningTaskSchema,
  LeadSchema,
  UpdateLeadSchema,
  ScheduleReminderSchema,
  MarkNotificationReadSchema,
} from '@/lib/schemas/ops';

// ── Announcements ─────────────────────────────────────────────────────────────

export async function createAnnouncement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-announcement');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AnnouncementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(announcements).values({
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      title: parsed.data.title,
      body: parsed.data.body,
      audience: parsed.data.audience,
      propertyId: parsed.data.property_id ?? null,
      unitId: parsed.data.unit_id ?? null,
      expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
    });
  } catch (err) {
    log.error('[createAnnouncement] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_announcement', 'announcement');
  revalidatePath('/dashboard/announcements');
  return ok(undefined);
}

export async function publishAnnouncement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'publish-announcement');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = PublishAnnouncementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify ownership
  const ann = await db.select({
    id: announcements.id,
    title: announcements.title,
    body: announcements.body,
    audience: announcements.audience,
    propertyId: announcements.propertyId,
    unitId: announcements.unitId,
  })
    .from(announcements)
    .where(and(eq(announcements.id, parsed.data.id), eq(announcements.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!ann) return Errors.NOT_FOUND();

  const now = new Date();

  try {
    await db.update(announcements)
      .set({ publishedAt: now, updatedAt: now })
      .where(eq(announcements.id, parsed.data.id));
  } catch (err) {
    log.error('[publishAnnouncement] update error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  // Fan-out notification_inbox rows to targeted tenants (IC-D2)
  try {
    let targetProfileIds: string[] = [];

    if (ann.audience === 'all') {
      const profileRows = await db.select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.orgId, ctx.orgId), eq(profiles.role, 'tenant')));
      targetProfileIds = profileRows.map(p => p.id);
    } else if (ann.audience === 'property' && ann.propertyId) {
      // Units in the property
      const unitRows = await db.select({ id: units.id })
        .from(units)
        .where(and(eq(units.propertyId, ann.propertyId), eq(units.orgId, ctx.orgId)));
      const unitIds = unitRows.map(u => u.id);

      if (unitIds.length > 0) {
        // Tenants in those units
        const tenantRows = await db.select({ profileId: tenants.profileId })
          .from(tenants)
          .where(and(
            eq(tenants.orgId, ctx.orgId),
            inArray(tenants.unitId, unitIds)
          ));
        const pids = tenantRows.map(t => t.profileId).filter((id): id is string => id !== null);

        if (pids.length > 0) {
          const profileRows = await db.select({ id: profiles.id })
            .from(profiles)
            .where(and(eq(profiles.orgId, ctx.orgId), inArray(profiles.id, pids)));
          targetProfileIds = profileRows.map(p => p.id);
        }
      }
    } else if (ann.audience === 'unit' && ann.unitId) {
      const tenantRows = await db.select({ profileId: tenants.profileId })
        .from(tenants)
        .where(and(eq(tenants.unitId, ann.unitId), eq(tenants.orgId, ctx.orgId)));
      const pids = tenantRows.map(t => t.profileId).filter((id): id is string => id !== null);

      if (pids.length > 0) {
        const profileRows = await db.select({ id: profiles.id })
          .from(profiles)
          .where(inArray(profiles.id, pids));
        targetProfileIds = profileRows.map(p => p.id);
      }
    }

    // Insert inbox rows (cap at 200 for inline fan-out)
    const batch = targetProfileIds.slice(0, 200);
    if (batch.length > 0) {
      await db.insert(notificationInbox).values(
        batch.map(pid => ({
          orgId: ctx.orgId,
          profileId: pid,
          type: 'announcement',
          title: ann.title,
          body: ann.body.slice(0, 200),
          relatedType: 'announcement',
          relatedId: parsed.data.id,
        }))
      );
    }
  } catch (e) {
    log.warn('[publishAnnouncement] inbox fan-out error', { error: e instanceof Error ? e.message : 'unknown' });
  }

  log.adminAction(ctx.userId, 'publish_announcement', 'announcement', parsed.data.id);
  revalidatePath('/dashboard/announcements');
  revalidatePath('/portal/announcements');
  return ok(undefined);
}

// ── Cleaning Tasks ─────────────────────────────────────────────────────────────

export async function createCleaningTask(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-cleaning-task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CleaningTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(cleaningTasks).values({
      orgId: ctx.orgId,
      unitId: parsed.data.unit_id ?? null,
      assignedTo: parsed.data.assigned_to ?? null,
      title: parsed.data.title,
      scheduledDate: parsed.data.scheduled_date,
      notes: parsed.data.notes ?? null,
    });
  } catch (err) {
    log.error('[createCleaningTask] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/cleaning');
  return ok(undefined);
}

export async function updateCleaningTask(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-cleaning-task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateCleaningTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const existing = await db.select({ id: cleaningTasks.id })
    .from(cleaningTasks)
    .where(and(eq(cleaningTasks.id, parsed.data.id), eq(cleaningTasks.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  const completedAt = updates.status === 'done' ? new Date() : null;

  try {
    await db.update(cleaningTasks).set({
      ...updates,
      completedAt,
      updatedAt: new Date(),
    }).where(and(eq(cleaningTasks.id, id), eq(cleaningTasks.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateCleaningTask] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/cleaning');
  return ok(undefined);
}

// ── CRM Leads ─────────────────────────────────────────────────────────────────

export async function createLead(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-lead');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = LeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(crmLeads).values({
      orgId: ctx.orgId,
      fullName: parsed.data.full_name,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
      propertyInterest: parsed.data.property_interest ?? null,
      source: parsed.data.source ?? null,
      notes: parsed.data.notes ?? null,
      status: 'new',
    });
  } catch (err) {
    log.error('[createLead] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/leads');
  return ok(undefined);
}

export async function updateLead(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-lead');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const existing = await db.select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, parsed.data.id), eq(crmLeads.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;

  try {
    await db.update(crmLeads).set({
      fullName: (updates as { full_name?: string }).full_name ?? existing.id,
      email: (updates as { email?: string | null }).email || null,
      phone: (updates as { phone?: string | null }).phone ?? null,
      propertyInterest: (updates as { property_interest?: string | null }).property_interest ?? null,
      source: (updates as { source?: string | null }).source ?? null,
      notes: (updates as { notes?: string | null }).notes ?? null,
      status: (updates as { status?: string }).status ?? 'new',
      updatedAt: new Date(),
    }).where(and(eq(crmLeads.id, id), eq(crmLeads.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateLead] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/leads');
  return ok(undefined);
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export async function scheduleReminder(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'schedule-reminder');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ScheduleReminderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(reminders).values({
      orgId: ctx.orgId,
      type: parsed.data.type,
      targetType: parsed.data.target_type,
      targetId: parsed.data.target_id,
      channel: parsed.data.channel,
      scheduledFor: parsed.data.scheduled_for,
      messagePreview: parsed.data.message_preview ?? null,
      status: 'scheduled',
    });
  } catch (err) {
    log.error('[scheduleReminder] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/reminders');
  return ok(undefined);
}

// ── Notification Inbox ────────────────────────────────────────────────────────

export async function markNotificationRead(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'mark-notification-read');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = MarkNotificationReadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Owner-scoped: profileId = ctx.userId enforced by Drizzle where clause
  try {
    await db
      .update(notificationInbox)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(notificationInbox.id, parsed.data.notification_id),
        eq(notificationInbox.profileId, ctx.userId),
        eq(notificationInbox.orgId, ctx.orgId)
      ));
  } catch (err) {
    log.error('[markNotificationRead] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/notifications');
  revalidatePath('/dashboard');
  return ok(undefined);
}
