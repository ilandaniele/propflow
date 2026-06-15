/**
 * Reminder engine — IC-D1
 *
 * Pure logic: evaluates lease-renewal + payment-due reminders.
 * Called from POST /api/cron/reminders.
 * Constraints:
 *   - Must complete < 60s for an org with thousands of active charges/contracts
 *   - Paginates evaluation query (page size ≤ 200 per batch)
 *   - Deduplicates via existing `reminders` rows to prevent double-send
 *   - On email failure: logs + marks reminder as failed; cron retries next run (A10)
 *   - Lease-renewal window: 30 days before end_date
 *   - Payment-due window: due_date and 3 days before
 *
 * W6: replaced SupabaseClient with Drizzle PostgresJsDatabase.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import {
  organizations,
  contracts,
  tenants,
  charges,
  reminders,
  notificationInbox,
  tenantTasks,
} from '@/lib/db/schema';
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

type DbClient = PostgresJsDatabase<typeof schema>;

export interface ReminderRunResult {
  orgId: string;
  contractsProcessed: number;
  chargesProcessed: number;
  remindersSent: number;
  remindersFailed: number;
  durationMs: number;
}

export interface ReminderEngineContext {
  db: DbClient;
  siteUrl: string;
}

/**
 * Run the reminder engine for all organizations.
 * Returns per-org summary for the cron response.
 */
export async function runReminderEngine(ctx: ReminderEngineContext): Promise<ReminderRunResult[]> {
  const start = Date.now();

  // Get all active orgs
  const orgs = await ctx.db.select({ id: organizations.id }).from(organizations).limit(200);
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
    const contractRows = await ctx.db
      .select({
        id:       contracts.id,
        endDate:  contracts.endDate,
        tenantId: contracts.tenantId,
        // Tenant fields joined
        tenantFullName:  tenants.fullName,
        tenantEmail:     tenants.email,
        tenantProfileId: tenants.profileId,
      })
      .from(contracts)
      .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
      .where(and(
        eq(contracts.orgId, orgId),
        eq(contracts.status, 'active'),
        gte(contracts.endDate, today),
        lte(contracts.endDate, renewalCutoff),
      ))
      .limit(PAGE_SIZE)
      .offset(contractOffset);

    if (!contractRows || contractRows.length === 0) break;
    contractOffset += contractRows.length;
    contractsProcessed += contractRows.length;

    // Dedup: batch-check which contract ids already have a sent/scheduled lease_renewal reminder today
    const contractIds = contractRows.map(c => c.id);
    const existingReminders = await ctx.db
      .select({ targetId: reminders.targetId })
      .from(reminders)
      .where(and(
        eq(reminders.orgId, orgId),
        eq(reminders.type, 'lease_renewal'),
        eq(reminders.targetType, 'contract'),
        eq(reminders.scheduledFor, today),
        inArray(reminders.targetId, contractIds),
        inArray(reminders.status, ['sent', 'scheduled']),
      ));
    const alreadyHandled = new Set(existingReminders.map(r => r.targetId));

    for (const contract of contractRows) {
      if (!contract.tenantEmail) continue;
      if (alreadyHandled.has(contract.id)) continue;

      const daysLeft = daysBetween(today, contract.endDate ?? today);
      const message = `Your lease expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${contract.endDate}). Please contact your landlord to discuss renewal.`;

      const { subject, html } = buildReminderEmail({
        recipientName: contract.tenantFullName ?? 'Tenant',
        type: 'lease_renewal',
        message,
        siteUrl: ctx.siteUrl,
      });

      const emailResult = await sendEmail({ to: contract.tenantEmail, subject, html, context: 'lease_renewal' });

      const [inserted] = await ctx.db.insert(reminders).values({
        orgId,
        type: 'lease_renewal',
        targetType: 'contract',
        targetId: contract.id,
        channel: 'both',
        scheduledFor: today,
        sentAt: emailResult.success ? new Date() : null,
        status: emailResult.success ? 'sent' : 'failed',
        messagePreview: message.slice(0, 200),
        error: emailResult.success ? null : emailResult.error,
      }).returning({ id: reminders.id });

      if (inserted && contract.tenantProfileId) {
        await ctx.db.insert(notificationInbox).values({
          orgId,
          profileId: contract.tenantProfileId,
          type: 'lease_renewal',
          title: 'Lease Renewal Reminder',
          body: message.slice(0, 200),
          relatedType: 'contract',
          relatedId: contract.id,
        });
      }

      if (emailResult.success) { remindersSent++; } else { remindersFailed++; }
    }

    if (contractRows.length < PAGE_SIZE) break;
    if (Date.now() - globalStart > 50_000) break;
  }

  // ── Payment-due reminders ──────────────────────────────────────────────────
  let chargeOffset = 0;
  while (true) {
    const chargeRows = await ctx.db
      .select({
        id:          charges.id,
        amount:      charges.amount,
        dueDate:     charges.dueDate,
        description: charges.description,
        tenantId:    charges.tenantId,
        tenantFullName:  tenants.fullName,
        tenantEmail:     tenants.email,
        tenantProfileId: tenants.profileId,
      })
      .from(charges)
      .innerJoin(tenants, eq(tenants.id, charges.tenantId))
      .where(and(
        eq(charges.orgId, orgId),
        gte(charges.dueDate, today),
        lte(charges.dueDate, paymentCutoff),
      ))
      .limit(PAGE_SIZE)
      .offset(chargeOffset);

    if (!chargeRows || chargeRows.length === 0) break;
    chargeOffset += chargeRows.length;
    chargesProcessed += chargeRows.length;

    const chargeIds = chargeRows.map(c => c.id);
    const existingChargeReminders = await ctx.db
      .select({ targetId: reminders.targetId })
      .from(reminders)
      .where(and(
        eq(reminders.orgId, orgId),
        eq(reminders.type, 'payment_due'),
        eq(reminders.targetType, 'charge'),
        eq(reminders.scheduledFor, today),
        inArray(reminders.targetId, chargeIds),
        inArray(reminders.status, ['sent', 'scheduled']),
      ));
    const alreadyHandledCharges = new Set(existingChargeReminders.map(r => r.targetId));

    for (const charge of chargeRows) {
      if (!charge.tenantEmail) continue;
      if (alreadyHandledCharges.has(charge.id)) continue;

      const message = `A payment of $${charge.amount} is due on ${charge.dueDate}${charge.description ? ` (${charge.description})` : ''}. Please log in to your portal to make your payment.`;

      const { subject, html } = buildReminderEmail({
        recipientName: charge.tenantFullName ?? 'Tenant',
        type: 'payment_due',
        message,
        siteUrl: ctx.siteUrl,
      });

      const emailResult = await sendEmail({ to: charge.tenantEmail, subject, html, context: 'payment_due' });

      const [inserted] = await ctx.db.insert(reminders).values({
        orgId,
        type: 'payment_due',
        targetType: 'charge',
        targetId: charge.id,
        channel: 'both',
        scheduledFor: today,
        sentAt: emailResult.success ? new Date() : null,
        status: emailResult.success ? 'sent' : 'failed',
        messagePreview: message.slice(0, 200),
        error: emailResult.success ? null : emailResult.error,
      }).returning({ id: reminders.id });

      if (inserted && charge.tenantProfileId) {
        await ctx.db.insert(notificationInbox).values({
          orgId,
          profileId: charge.tenantProfileId,
          type: 'payment_due',
          title: 'Payment Due Reminder',
          body: message.slice(0, 200),
          relatedType: 'charge',
          relatedId: charge.id,
        });
      }

      if (emailResult.success) { remindersSent++; } else { remindersFailed++; }
    }

    if (chargeRows.length < PAGE_SIZE) break;
    if (Date.now() - globalStart > 50_000) break;
  }

  // ── Task reminders & expiry ────────────────────────────────────────────────
  let taskOffset = 0;
  while (true) {
    const taskRows = await ctx.db
      .select({
        id:       tenantTasks.id,
        title:    tenantTasks.title,
        taskType: tenantTasks.taskType,
        dueAt:    tenantTasks.dueAt,
        status:   tenantTasks.status,
        tenantId: tenantTasks.tenantId,
        tenantFullName:       tenants.fullName,
        tenantEmail:          tenants.email,
        tenantProfileId:      tenants.profileId,
        tenantPreferredLang:  tenants.preferredLanguage,
        tenantWhatsappPhone:  tenants.whatsappPhone,
        tenantWhatsappOptIn:  tenants.whatsappOptIn,
      })
      .from(tenantTasks)
      .innerJoin(tenants, eq(tenants.id, tenantTasks.tenantId))
      .where(and(
        eq(tenantTasks.orgId, orgId),
        inArray(tenantTasks.status, ['pending', 'in_progress']),
      ))
      .limit(PAGE_SIZE)
      .offset(taskOffset);

    if (!taskRows || taskRows.length === 0) break;
    taskOffset += taskRows.length;

    const now = new Date().toISOString();

    for (const task of taskRows) {
      // Check if task is expired
      if (task.dueAt && task.dueAt.toISOString() < now && task.status === 'pending') {
        await ctx.db
          .update(tenantTasks)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(tenantTasks.id, task.id));

        emit('task.expired', {
          orgId,
          taskId: task.id,
          tenantId: task.tenantId,
        }, `task.expired:${task.id}`);

        continue;
      }

      // Check if reminder should be sent (due within 24h and not yet reminded)
      const dueInHours = task.dueAt
        ? (task.dueAt.getTime() - Date.now()) / (60 * 60 * 1000)
        : null;
      if (dueInHours !== null && dueInHours > 0 && dueInHours <= TASK_REMINDER_HOURS) {
        // Dedup: check if reminder already sent today
        const existingTaskReminders = await ctx.db
          .select({ id: reminders.id })
          .from(reminders)
          .where(and(
            eq(reminders.orgId, orgId),
            eq(reminders.type, 'task_reminder'),
            eq(reminders.targetType, 'tenant_task'),
            eq(reminders.targetId, task.id),
            eq(reminders.scheduledFor, today),
            inArray(reminders.status, ['sent', 'scheduled']),
          ))
          .limit(1);

        if (existingTaskReminders.length > 0) continue;

        const locale = task.tenantPreferredLang ?? 'es';
        const dueDate = task.dueAt ? new Date(task.dueAt).toLocaleDateString() : '';
        const body = buildWhatsAppTemplate('taskReminder', locale, {
          title: task.title,
          date: dueDate,
        });

        let reminderStatus: 'sent' | 'failed' = 'failed';

        // Send WhatsApp if tenant has phone + opt_in
        if (task.tenantWhatsappPhone && task.tenantWhatsappOptIn) {
          const provider = getWhatsAppProvider();
          const sendResult = await provider.sendMessage(orgId, {
            to: task.tenantWhatsappPhone,
            body,
          });

          if (sendResult.success && sendResult.providerMessageId) {
            // Upsert conversation + insert message — these helpers accept a db param
            // but still have an adminClient param; pass the db-backed adapter
            const convId = await upsertConversation({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              adminClient: ctx.db as any,
              orgId,
              externalPhone: task.tenantWhatsappPhone,
              tenantId: task.tenantId,
            }).catch(() => null);

            if (convId) {
              await insertMessage({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                adminClient: ctx.db as any,
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

        await ctx.db.insert(reminders).values({
          orgId,
          type: 'task_reminder',
          targetType: 'tenant_task',
          targetId: task.id,
          channel: 'whatsapp',
          scheduledFor: today,
          sentAt: reminderStatus === 'sent' ? new Date() : null,
          status: reminderStatus,
          messagePreview: body.slice(0, 200),
        });

        if (reminderStatus === 'sent') {
          remindersSent++;
        } else {
          remindersFailed++;
        }
      }
    }

    if (taskRows.length < PAGE_SIZE) break;
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
