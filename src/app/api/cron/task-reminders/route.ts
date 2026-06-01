/**
 * POST /api/cron/task-reminders
 * Daily 8am UTC cron — send interactive WhatsApp reminder buttons to tenants
 * with pending tasks due within the next 24 hours.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — IC11).
 * Uses service-role Supabase client (bypasses RLS for cron context).
 *
 * Idempotency: tasks with reminder_sent_at IS NOT NULL are skipped.
 * A second invocation the same day sends zero new messages.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWhatsAppPhase6Template } from '@/lib/whatsapp/templates';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison (IC11 — same pattern as reminders cron)
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
    const adminClient = createAdminClient();
    const provider    = getWhatsAppProvider();

    // Query tasks due within the next 24 hours, not yet reminded
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: tasks, error: queryError } = await adminClient
      .from('tenant_tasks')
      .select(`
        id,
        org_id,
        title,
        due_at,
        tenant_id,
        tenants!inner (
          id,
          phone
        )
      `)
      .eq('status', 'pending')
      .lte('due_at', cutoff)
      .is('reminder_sent_at', null);

    if (queryError) {
      log.error('[cron/task-reminders] query failed', { error: queryError.message });
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Query failed' } },
        { status: 500 }
      );
    }

    let sent    = 0;
    let skipped = 0;
    let failed  = 0;

    for (const task of tasks ?? []) {
      // Type assertion: Supabase join may return array or object depending on relation type
      type TenantRow = { id: string; phone: string | null };
      const tenantRaw = task.tenants as unknown;
      const tenant    = Array.isArray(tenantRaw)
        ? (tenantRaw[0] as TenantRow | undefined) ?? null
        : (tenantRaw as TenantRow | null);
      const phone = tenant?.phone ?? null;

      if (!phone) {
        skipped++;
        continue;
      }

      // Format due_at for display (no PII: not a phone number or name)
      const dueDate = task.due_at
        ? new Date(task.due_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

      const bodyText = buildWhatsAppPhase6Template('taskDailyReminder', 'es', {
        title: task.title,
        date:  dueDate,
      });

      try {
        if (provider.sendInteractiveButtons) {
          await provider.sendInteractiveButtons(task.org_id, {
            to:       phone,
            bodyText,
            buttons: [
              { id: `task:${task.id}:listo`,    title: 'Listo' },
              { id: `task:${task.id}:no_puedo`, title: 'No puedo' },
            ],
          });
        } else {
          await provider.sendMessage(task.org_id, { to: phone, body: bodyText });
        }

        // Mark reminder_sent_at
        await adminClient
          .from('tenant_tasks')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', task.id);

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
