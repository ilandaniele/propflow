/**
 * Handler: task.button_pressed { action: 'listo' }
 * Tenant pressed "Listo" — transition task to awaiting_proof and prompt for photo.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';
import type { TaskButtonPressedPayload } from '../types';

export async function handleTaskButtonListo(
  payload: TaskButtonPressedPayload
): Promise<void> {
  const { orgId, taskId, fromPhone } = payload;
  const adminClient = createAdminClient();

  // 1. Update task status to awaiting_proof
  const { error: updateError } = await adminClient
    .from('tenant_tasks')
    .update({
      status:     'awaiting_proof',
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('org_id', orgId);

  if (updateError) {
    log.error('[task-button-listo] status update failed', {
      orgId,
      taskId,
      errorCode: updateError.code,
    });
    return;
  }

  log.info('[task-button-listo] task transitioned to awaiting_proof', { orgId, taskId });

  // 2. Fetch task for template context
  const { data: task } = await adminClient
    .from('tenant_tasks')
    .select('title, task_type')
    .eq('id', taskId)
    .single();

  // 3. Send interactive buttons or text asking for photo proof
  const provider = getWhatsAppProvider();
  const body = buildWhatsAppPhase6Template('taskAwaitingProof', 'es', {
    title: task?.title ?? 'la tarea',
  });

  try {
    if (provider.sendInteractiveButtons) {
      await provider.sendInteractiveButtons(orgId, {
        to: fromPhone,
        bodyText: body,
        buttons: [
          { id: `task:${taskId}:listo`, title: 'Enviar foto' },
        ],
      });
    } else {
      await provider.sendMessage(orgId, { to: fromPhone, body });
    }
  } catch (e) {
    log.warn('[task-button-listo] outbound message failed', {
      orgId,
      taskId,
      error: e instanceof Error ? e.message : 'unknown',
    });
  }
}
