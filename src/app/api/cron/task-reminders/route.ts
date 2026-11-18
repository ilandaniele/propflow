/**
 * POST /api/cron/task-reminders
 * Fly scheduled machine (replaces Vercel Cron) — send WhatsApp reminder buttons
 * to tenants with pending tasks due within the next 24 hours.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 * Idempotency: tasks with reminder_sent_at IS NOT NULL are skipped.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenantTasks, tenants } from '@/lib/db/schema';
import { eq, and, isNull, lte } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison (AC10)
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/task-reminders] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual   = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/task-reminders] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    const provider = getWhatsAppProvider();

    // Query tasks due within the next 24 hours, not yet reminded — Drizzle (AC1)
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const tasks = await db
      .select({
        id:       tenantTasks.id,
        orgId:    tenantTasks.orgId,
        title:    tenantTasks.title,
        dueAt:    tenantTasks.dueAt,
        tenantId: tenantTasks.tenantId,
        phone:    tenants.phone,
      })
      .from(tenantTasks)
      .innerJoin(tenants, eq(tenantTasks.tenantId, tenants.id))
      .where(
        and(
          eq(tenantTasks.status, 'pending'),
          lte(tenantTasks.dueAt, cutoff),
          isNull(tenantTasks.reminderSentAt)
        )
      );

    let sent    = 0;
    let skipped = 0;
    let failed  = 0;

    for (const task of tasks) {
      const phone = task.phone ?? null;

      if (!phone) {
        skipped++;
        continue;
      }

      // Format due_at for display (no PII: not a phone number or name)
      const dueDate = task.dueAt
        ? new Date(task.dueAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

      const bodyText = buildWhatsAppPhase6Template('taskDailyReminder', 'es', {
        title: task.title,
        date:  dueDate,
      });

      try {
        if (provider.sendInteractiveButtons) {
          await provider.sendInteractiveButtons(task.orgId, {
            to:       phone,
            bodyText,
            buttons: [
              { id: `task:${task.id}:listo`,    title: 'Listo' },
              { id: `task:${task.id}:no_puedo`, title: 'No puedo' },
            ],
          });
        } else {
          await provider.sendMessage(task.orgId, { to: phone, body: bodyText });
        }

        // Mark reminder_sent_at — Drizzle (AC1)
        await db
          .update(tenantTasks)
          .set({ reminderSentAt: new Date() })
          .where(eq(tenantTasks.id, task.id));

        sent++;
      } catch (e) {
        log.error('[cron/task-reminders] send failed', {
          taskId:   task.id,
          errorMsg: e instanceof Error ? e.message : 'unknown',
          // Never log phone number
        });
        failed++;
      }
    }

    log.info('[cron/task-reminders] run complete', { sent, skipped, failed });

    return NextResponse.json({ status: 'ok', sent, skipped, failed });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[cron/task-reminders] exception', { error: msg });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
