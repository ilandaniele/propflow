/**
 * Handler: task.button_pressed { action: 'no_puedo' }
 * Tenant pressed "No puedo" — block the task and alert admin.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';
import type { TaskButtonPressedPayload } from '../types';

export async function handleTaskButtonNoPuedo(
  payload: TaskButtonPressedPayload
): Promise<void> {
  const { orgId, taskId, fromPhone } = payload;
  const adminClient = createAdminClient();

  // 1. Update task status to blocked_by_tenant
  const { error: updateError } = await adminClient
    .from('tenant_tasks')
    .update({
      status:     'blocked_by_tenant',
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('org_id', orgId);

  if (updateError) {
    log.error('[task-button-no-puedo] status update failed', {
      orgId,
      taskId,
      errorCode: updateError.code,
    });
    return;
  }

  log.info('[task-button-no-puedo] task transitioned to blocked_by_tenant', { orgId, taskId });

  // 2. Fetch task for notification context
  const { data: task } = await adminClient
    .from('tenant_tasks')
    .select('title, task_type')
    .eq('id', taskId)
    .single();

  // 3. Insert notification_inbox row for the org admin
  const { data: adminProfile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (adminProfile) {
    const { error: notifError } = await adminClient.from('notification_inbox').insert({
      org_id:       orgId,
      profile_id:   adminProfile.id,
      type:         'task_blocked',
      title:        'Task Blocked by Tenant',
      body:         `Task "${task?.title ?? taskId}" was blocked by the tenant (No puedo).`,
      related_type: 'task',
      related_id:   taskId,
    });
    if (notifError) {
      log.warn('[task-button-no-puedo] notification insert failed', {
        orgId,
        errorCode: notifError.code,
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
