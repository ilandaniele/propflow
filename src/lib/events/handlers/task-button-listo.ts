/**
 * Handler: task.button_pressed { action: 'listo' }
 * Tenant pressed "Listo" — transition task to awaiting_proof and prompt for photo.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { tenantTasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';
import type { TaskButtonPressedPayload } from '../types';

export async function handleTaskButtonListo(
  payload: TaskButtonPressedPayload
): Promise<void> {
  const { orgId, taskId, fromPhone } = payload;

  // 1. Update task status to awaiting_proof
  const updated = await db
    .update(tenantTasks)
    .set({ status: 'awaiting_proof', updatedAt: new Date() })
    .where(and(eq(tenantTasks.id, taskId), eq(tenantTasks.orgId, orgId)))
    .returning({ id: tenantTasks.id });

  if (updated.length === 0) {
    log.error('[task-button-listo] status update failed — row not found', { orgId, taskId });
    return;
  }

  log.info('[task-button-listo] task transitioned to awaiting_proof', { orgId, taskId });

  // 2. Fetch task for template context
  const taskRows = await db
    .select({ title: tenantTasks.title, taskType: tenantTasks.taskType })
    .from(tenantTasks)
    .where(and(eq(tenantTasks.id, taskId), eq(tenantTasks.orgId, orgId)))
    .limit(1);

  const task = taskRows[0];

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
