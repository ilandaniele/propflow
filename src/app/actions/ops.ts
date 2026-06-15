'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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

  const supabase = await createClient();
  const { error } = await supabase.from('announcements').insert({
    org_id: ctx.orgId,
    created_by: ctx.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    audience: parsed.data.audience,
    property_id: parsed.data.property_id ?? null,
    unit_id: parsed.data.unit_id ?? null,
    expires_at: parsed.data.expires_at ?? null,
  });

  if (error) {
    log.error('[createAnnouncement] db error', { code: error.code });
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

  const supabase = await createClient();

  // Verify ownership
  const { data: ann } = await supabase
    .from('announcements').select('id, title, body, audience, property_id, unit_id')
    .eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!ann) return Errors.NOT_FOUND();

  const now = new Date().toISOString();
  await supabase.from('announcements').update({ published_at: now, updated_at: now }).eq('id', parsed.data.id);

  // Fan-out notification_inbox rows to targeted tenants (IC-D2)
  try {
    let targetProfiles: { id: string }[] = [];

    if (ann.audience === 'all') {
      const { data: profiles } = await supabase
        .from('profiles').select('id').eq('org_id', ctx.orgId).eq('role', 'tenant');
      targetProfiles = profiles ?? [];
    } else if (ann.audience === 'property' && ann.property_id) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('org_id', ctx.orgId)
        .eq('role', 'tenant')
        .in('id', (
          await supabase
            .from('tenants')
            .select('profile_id')
            .eq('org_id', ctx.orgId)
            .in('unit_id', (
              await supabase.from('units').select('id').eq('property_id', ann.property_id).eq('org_id', ctx.orgId)
            ).data?.map((u: { id: string }) => u.id) ?? [])
        ).data?.map((t: { profile_id: string | null }) => t.profile_id).filter(Boolean) ?? []);
      targetProfiles = profiles ?? [];
    } else if (ann.audience === 'unit' && ann.unit_id) {
      const { data: tenants } = await supabase
        .from('tenants').select('profile_id').eq('unit_id', ann.unit_id).eq('org_id', ctx.orgId);
      const profileIds = (tenants ?? []).map((t: { profile_id: string | null }) => t.profile_id).filter(Boolean) as string[];
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id').in('id', profileIds);
        targetProfiles = profiles ?? [];
      }
    }

    // Insert inbox rows (cap at 200 for inline fan-out)
    const batch = targetProfiles.slice(0, 200);
    if (batch.length > 0) {
      await supabase.from('notification_inbox').insert(
        batch.map(p => ({
          org_id: ctx.orgId,
          profile_id: p.id,
          type: 'announcement',
          title: ann.title,
          body: ann.body.slice(0, 200),
          related_type: 'announcement',
          related_id: parsed.data.id,
        }))
      );
    }
  } catch (e) {
    // Non-fatal: notification fan-out failure doesn't block the publish
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

  const supabase = await createClient();
  const { error } = await supabase.from('cleaning_tasks').insert({
    org_id: ctx.orgId,
    unit_id: parsed.data.unit_id ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    title: parsed.data.title,
    scheduled_date: parsed.data.scheduled_date,
    notes: parsed.data.notes ?? null,
  });

  if (error) {
    log.error('[createCleaningTask] db error', { code: error.code });
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

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('cleaning_tasks').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  const completedAt = updates.status === 'done' ? new Date().toISOString() : null;

  const { error } = await supabase.from('cleaning_tasks').update({
    ...updates,
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateCleaningTask] db error', { code: error.code });
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

  const supabase = await createClient();
  const { error } = await supabase.from('crm_leads').insert({
    org_id: ctx.orgId,
    ...parsed.data,
    email: parsed.data.email || null,
  });

  if (error) {
    log.error('[createLead] db error', { code: error.code });
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

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('crm_leads').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  const { error } = await supabase.from('crm_leads').update({
    ...updates,
    email: (updates as { email?: string | null }).email || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateLead] db error', { code: error.code });
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

  const supabase = await createClient();
  const { error } = await supabase.from('reminders').insert({
    org_id: ctx.orgId,
    type: parsed.data.type,
    target_type: parsed.data.target_type,
    target_id: parsed.data.target_id,
    channel: parsed.data.channel,
    scheduled_for: parsed.data.scheduled_for,
    message_preview: parsed.data.message_preview ?? null,
    status: 'scheduled',
  });

  if (error) {
    log.error('[scheduleReminder] db error', { code: error.code });
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

  const supabase = await createClient();

  // Owner-scoped: profile_id = auth.uid() enforced by RLS + explicit check
  const { error } = await supabase
    .from('notification_inbox')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', parsed.data.notification_id)
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[markNotificationRead] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/notifications');
  revalidatePath('/dashboard');
  return ok(undefined);
}
