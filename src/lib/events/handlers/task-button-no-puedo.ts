/**
 * Handler: task.button_pressed { action: 'no_puedo' }
 * Tenant pressed "No puedo" — block the task and alert admin.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { tenantTasks, profiles, notificationInbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';
import type { TaskButtonPressedPayload } from '../types';

export async function handleTaskButtonNoPuedo(
  payload: TaskButtonPressedPayload
): Promise<void> {
  const { orgId, taskId, fromPhone } = payload;

  // 1. Update task status to blocked_by_tenant
  const updated = await db
    .update(tenantTasks)
    .set({ status: 'blocked_by_tenant', updatedAt: new Date() })
    .where(and(eq(tenantTasks.id, taskId), eq(tenantTasks.orgId, orgId)))
    .returning({ id: tenantTasks.id });

  if (updated.length === 0) {
    log.error('[task-button-no-puedo] status update failed — row not found', { orgId, taskId });
    return;
  }

  log.info('[task-button-no-puedo] task transitioned to blocked_by_tenant', { orgId, taskId });

  // 2. Fetch task for notification context
  const taskRows = await db
    .select({ title: tenantTasks.title, taskType: tenantTasks.taskType })
    .from(tenantTasks)
    .where(and(eq(tenantTasks.id, taskId), eq(tenantTasks.orgId, orgId)))
    .limit(1);

  const task = taskRows[0];

  // 3. Insert notification_inbox row for the org admin
  const adminRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(1);

  const adminProfile = adminRows[0];
  if (adminProfile) {
    try {
      await db.insert(notificationInbox).values({
        orgId,
        profileId:   adminProfile.id,
        type:        'task_blocked',
        title:       'Task Blocked by Tenant',
        body:        `Task "${task?.title ?? taskId}" was blocked by the tenant (No puedo).`,
        relatedType: 'task',
        relatedId:   taskId,
      });
    } catch (e) {
      log.warn('[task-button-no-puedo] notification insert failed', {
        orgId,
        error: e instanceof Error ? e.message : 'unknown',
      });
    }
  }

  // 4. Send ack message to tenant
  const provider = getWhatsAppProvider();
  const ackBody = buildWhatsAppPhase6Template('taskBlockedAck', 'es', {
    title: task?.title ?? 'la tarea',
  });

  try {
    await provider.sendMessage(orgId, { to: fromPhone, body: ackBody });
  } catch (e) {
    log.warn('[task-button-no-puedo] ack message failed', {
      orgId,
      error: e instanceof Error ? e.message : 'unknown',
    });
  }
}
