/**
 * Reminder engine — IC-D1
 *
 * Pure logic: evaluates lease-renewal + payment-due reminders.
 * Called from POST /api/cron/reminders with a service-role client.
 * Constraints:
 *   - Must complete < 60s for an org with thousands of active charges/contracts
 *   - Paginates evaluation query (page size ≤ 200 per batch)
 *   - Deduplicates via existing `reminders` rows to prevent double-send
 *   - On email failure: logs + marks reminder as failed; cron retries next run (A10)
 *   - Lease-renewal window: 30 days before end_date (defaulted per spec open question)
 *   - Payment-due window: due_date and 3 days before (defaulted per spec open question)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, buildReminderEmail } from './email';
import { log } from '@/lib/log';
import { buildWhatsAppTemplate } from '@/lib/whatsapp/templates';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { upsertConversation, insertMessage } from '@/lib/whatsapp/db';
import { emit } from '@/lib/events/emit';

const LEASE_RENEWAL_DAYS = 30;
const PAYMENT_DUE_DAYS_AHEAD = 3;
const TASK_REMINDER_HOURS = 24;
const PAGE_SIZE = 200; // rows per pagination batch

export interface ReminderRunResult {
  orgId: string;
  contractsProcessed: number;
  chargesProcessed: number;
  remindersSent: number;
  remindersFailed: number;
  durationMs: number;
}

export interface ReminderEngineContext {
  adminClient: SupabaseClient; // service-role, bypasses RLS
  siteUrl: string;
}

/**
 * Run the reminder engine for all organizations.
 * Returns per-org summary for the cron response.
 */
export async function runReminderEngine(ctx: ReminderEngineContext): Promise<ReminderRunResult[]> {
  const start = Date.now();

  // Get all active orgs
  const { data: orgs } = await ctx.adminClient.from('organizations').select('id').limit(200);
  if (!orgs || orgs.length === 0) return [];

  const results: ReminderRunResult[] = [];

  for (const org of orgs) {
    const result = await processOrg(org.id, ctx, start);
    results.push(result);

    // Safety: abort if we're close to the 60s limit
    if (Date.now() - start > 50_000) {
      log.warn('[reminder-engine] approaching 60s limit, stopping early');
      break;
    }
  }

  return results;
}

async function processOrg(
  orgId: string,
  ctx: ReminderEngineContext,
  globalStart: number
): Promise<ReminderRunResult> {
  const start = Date.now();
  let contractsProcessed = 0;
  let chargesProcessed = 0;
  let remindersSent = 0;
  let remindersFailed = 0;

  const today = todayStr();
  const renewalCutoff = addDays(today, LEASE_RENEWAL_DAYS);
  const paymentCutoff = addDays(today, PAYMENT_DUE_DAYS_AHEAD);

  // ── Lease-renewal reminders ────────────────────────────────────────────────
  let contractOffset = 0;
  while (true) {
    const { data: contracts } = await ctx.adminClient
      .from('contracts')
      .select(`
        id, end_date,
        tenant:tenants(id, full_name, email, profile_id),
        unit:units(label, property:properties(name))
      `)
      .eq('org_id', orgId)
      .eq('status', 'active')
      .gte('end_date', today)
      .lte('end_date', renewalCutoff)
      .order('end_date', { ascending: true })
      .range(contractOffset, contractOffset + PAGE_SIZE - 1);

    if (!contracts || contracts.length === 0) break;
    contractOffset += contracts.length;
    contractsProcessed += contracts.length;

    for (const contract of contracts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenant = contract.tenant as any;
      if (!tenant?.email) continue;

      // Dedup: check if a lease_renewal reminder for this contract was already sent today
      const { data: existing } = await ctx.adminClient
        .from('reminders')
        .select('id')
        .eq('org_id', orgId)
        .eq('type', 'lease_renewal')
        .eq('target_type', 'contract')
        .eq('target_id', contract.id)
        .eq('scheduled_for', today)
        .in('status', ['sent', 'scheduled'])
        .limit(1);

      if (existing && existing.length > 0) continue; // already handled

      const daysLeft = daysBetween(today, contract.end_date);
      const message = `Your lease for ${(contract as {unit?: {label?: string}}).unit?.label ?? 'your unit'} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${contract.end_date}). Please contact your landlord to discuss renewal.`;

      const { subject, html } = buildReminderEmail({
        recipientName: tenant.full_name ?? 'Tenant',
        type: 'lease_renewal',
        message,
        siteUrl: ctx.siteUrl,
      });

      const emailResult = await sendEmail({ to: tenant.email, subject, html, context: 'lease_renewal' });

      // Insert reminder row (sent or failed)
      const { data: reminder } = await ctx.adminClient.from('reminders').insert({
        org_id: orgId,
        type: 'lease_renewal',
        target_type: 'contract',
        target_id: contract.id,
        channel: 'both',
        scheduled_for: today,
        sent_at: emailResult.success ? new Date().toISOString() : null,
        status: emailResult.success ? 'sent' : 'failed',
        message_preview: message.slice(0, 200),
        error: emailResult.success ? null : emailResult.error,
      }).select('id').single();

      if (reminder && tenant.profile_id) {
        // Write notification_inbox row
        await ctx.adminClient.from('notification_inbox').insert({
          org_id: orgId,
          profile_id: tenant.profile_id,
          type: 'lease_renewal',
          title: 'Lease Renewal Reminder',
          body: message.slice(0, 200),
          related_type: 'contract',
          related_id: contract.id,
        });
      }

      if (emailResult.success) { remindersSent++; } else { remindersFailed++; }
    }

    if (contracts.length < PAGE_SIZE) break;
    if (Date.now() - globalStart > 50_000) break;
  }

  // ── Payment-due reminders ──────────────────────────────────────────────────
  let chargeOffset = 0;
  while (true) {
    const { data: charges } = await ctx.adminClient
      .from('charges')
      .select(`
        id, amount, due_date, description,
        tenant:tenants(id, full_name, email, profile_id)
      `)
      .eq('org_id', orgId)
      .gte('due_date', today)
      .lte('due_date', paymentCutoff)
      .order('due_date', { ascending: true })
      .range(chargeOffset, chargeOffset + PAGE_SIZE - 1);

    if (!charges || charges.length === 0) break;
    chargeOffset += charges.length;
    chargesProcessed += charges.length;

    for (const charge of charges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenant = charge.tenant as any;
      if (!tenant?.email) continue;

      const { data: existing } = await ctx.adminClient
        .from('reminders')
        .select('id')
        .eq('org_id', orgId)
        .eq('type', 'payment_due')
        .eq('target_type', 'charge')
        .eq('target_id', charge.id)
        .eq('scheduled_for', today)
        .in('status', ['sent', 'scheduled'])
        .limit(1);

      if (existing && existing.length > 0) continue;

      const message = `A payment of $${charge.amount} is due on ${charge.due_date}${charge.description ? ` (${charge.description})` : ''}. Please log in to your portal to make your payment.`;

      const { subject, html } = buildReminderEmail({
        recipientName: tenant.full_name ?? 'Tenant',
        type: 'payment_due',
        message,
        siteUrl: ctx.siteUrl,
      });

      const emailResult = await sendEmail({ to: tenant.email, subject, html, context: 'payment_due' });

      const { data: reminder } = await ctx.adminClient.from('reminders').insert({
        org_id: orgId,
        type: 'payment_due',
        target_type: 'charge',
        target_id: charge.id,
        channel: 'both',
        scheduled_for: today,
        sent_at: emailResult.success ? new Date().toISOString() : null,
        status: emailResult.success ? 'sent' : 'failed',
        message_preview: message.slice(0, 200),
        error: emailResult.success ? null : emailResult.error,
      }).select('id').single();

      if (reminder && tenant.profile_id) {
        await ctx.adminClient.from('notification_inbox').insert({
          org_id: orgId,
          profile_id: tenant.profile_id,
          type: 'payment_due',
          title: 'Payment Due Reminder',
          body: message.slice(0, 200),
          related_type: 'charge',
          related_id: charge.id,
        });
      }

      if (emailResult.success) { remindersSent++; } else { remindersFailed++; }
    }

    if (charges.length < PAGE_SIZE) break;
    if (Date.now() - globalStart > 50_000) break;
  }

  // ── Task reminders & expiry ────────────────────────────────────────────────
  let taskOffset = 0;
  while (true) {
    const { data: tasks } = await ctx.adminClient
      .from('tenant_tasks')
      .select(`
        id, title, task_type, due_at, status,
        tenant:tenants(id, full_name, email, profile_id, preferred_language, whatsapp_phone, whatsapp_opt_in)
      `)
      .eq('org_id', orgId)
      .in('status', ['pending', 'in_progress'])
      .order('due_at', { ascending: true })
      .range(taskOffset, taskOffset + PAGE_SIZE - 1);

    if (!tasks || tasks.length === 0) break;
    taskOffset += tasks.length;

    const now = new Date().toISOString();

    for (const task of tasks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenant = task.tenant as any;
      if (!tenant) continue;

      // Check if task is expired
      if (task.due_at < now && task.status === 'pending') {
        await ctx.adminClient
          .from('tenant_tasks')
          .update({ status: 'expired', updated_at: now })
          .eq('id', task.id);

        emit('task.expired', {
          orgId,
          taskId: task.id,
          tenantId: tenant.id,
        }, `task.expired:${task.id}`);

        continue;
      }

      // Check if reminder should be sent (due within 24h and not yet reminded)
      const dueInHours = (new Date(task.due_at).getTime() - Date.now()) / (60 * 60 * 1000);
      if (dueInHours > 0 && dueInHours <= TASK_REMINDER_HOURS) {
        // Dedup: check if reminder already sent today
        const { data: existing } = await ctx.adminClient
          .from('reminders')
          .select('id')
          .eq('org_id', orgId)
          .eq('type', 'task_reminder')
          .eq('target_type', 'tenant_task')
          .eq('target_id', task.id)
          .eq('scheduled_for', today)
          .in('status', ['sent', 'scheduled'])
          .limit(1);

        if (existing && existing.length > 0) continue;

        const locale = tenant.preferred_language ?? 'es';
        const dueDate = new Date(task.due_at).toLocaleDateString();
        const body = buildWhatsAppTemplate('taskReminder', locale, {
          title: task.title,
          date: dueDate,
        });

        let reminderStatus: 'sent' | 'failed' = 'failed';

        // Send WhatsApp if tenant has phone + opt_in
        if (tenant.whatsapp_phone && tenant.whatsapp_opt_in) {
          const provider = getWhatsAppProvider();
          const sendResult = await provider.sendMessage(orgId, {
            to: tenant.whatsapp_phone,
            body,
          });

          if (sendResult.success && sendResult.providerMessageId) {
            // Upsert conversation + insert message
            const convId = await upsertConversation({
              adminClient: ctx.adminClient,
              orgId,
              externalPhone: tenant.whatsapp_phone,
              tenantId: tenant.id,
            }).catch(() => null);

            if (convId) {
              await insertMessage({
                adminClient: ctx.adminClient,
                orgId,
                conversationId: convId,
                direction: 'outbound',
                providerMessageId: sendResult.providerMessageId,
                body,
                status: 'sent',
              }).catch(() => null);
            }
            reminderStatus = 'sent';
          }
        }

        // Insert reminders row for dedup
        await ctx.adminClient.from('reminders').insert({
          org_id: orgId,
          type: 'task_reminder',
          target_type: 'tenant_task',
          target_id: task.id,
          channel: 'whatsapp',
          scheduled_for: today,
          sent_at: reminderStatus === 'sent' ? now : null,
          status: reminderStatus,
          message_preview: body.slice(0, 200),
        });

        if (reminderStatus === 'sent') {
          remindersSent++;
        } else {
          remindersFailed++;
        }
      }
    }

    if (tasks.length < PAGE_SIZE) break;
    if (Date.now() - globalStart > 50_000) break;
  }

  return {
    orgId,
    contractsProcessed,
    chargesProcessed,
    remindersSent,
    remindersFailed,
    durationMs: Date.now() - start,
  };
}

// ── Pure date helpers ──────────────────────────────────────────────────────────

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function addHours(dateStr: string, hours: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}
