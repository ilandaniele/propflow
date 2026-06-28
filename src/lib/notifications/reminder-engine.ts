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
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import {
  organizations,
  contracts,
  tenants,
  units,
  properties,
  charges,
  reminders,
  notificationInbox,
  tenantTasks,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
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

/**
 * Run the reminder engine for all organizations.
 * Returns per-org summary for the cron response.
 */
export async function runReminderEngine(siteUrl: string): Promise<ReminderRunResult[]> {
  const start = Date.now();

  // Fly.io machines resume from suspension with stale TCP connections.
  // Retry the first DB query up to 3 times with 2s backoff before giving up.
  let orgRows: Array<{ id: string }> = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      orgRows = await db.select({ id: organizations.id }).from(organizations).limit(200);
      break;
    } catch (err) {
      if (attempt < 2) {
        log.warn('[reminder-engine] DB connection failed, retrying', { attempt, error: (err as Error).message });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }

  if (!orgRows || orgRows.length === 0) return [];

  const results: ReminderRunResult[] = [];

  for (const org of orgRows) {
    const result = await processOrg(org.id, siteUrl, start);
    results.push(result);

    if (Date.now() - start > 50_000) {
      log.warn('[reminder-engine] approaching 60s limit, stopping early');
      break;
    }
  }

  return results;
}

async function processOrg(
  orgId: string,
  siteUrl: string,
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
    const contractRows = await db
      .select({
        id:      contracts.id,
        endDate: contracts.endDate,
        tenantId: contracts.tenantId,
        unitId:   contracts.unitId,
      })
      .from(contracts)
      .where(and(
        eq(contracts.orgId, orgId),
        eq(contracts.status, 'active'),
        gte(contracts.endDate, today),
        lte(contracts.endDate, renewalCutoff),
      ))
      .orderBy(contracts.endDate)
      .limit(PAGE_SIZE)
      .offset(contractOffset);

    if (!contractRows || contractRows.length === 0) break;
    contractOffset += contractRows.length;
    contractsProcessed += contractRows.length;

    // Fetch tenant details for these contracts
    const tenantIds = contractRows.map((c) => c.tenantId).filter(Boolean) as string[];
    const unitIds = contractRows.map((c) => c.unitId).filter(Boolean) as string[];

    const tenantMap = new Map<string, { fullName: string | null; email: string | null; profileId: string | null }>();
    if (tenantIds.length > 0) {
      const tenantRows = await db
        .select({ id: tenants.id, fullName: tenants.fullName, email: tenants.email, profileId: tenants.profileId })
        .from(tenants)
        .where(and(eq(tenants.orgId, orgId), inArray(tenants.id, tenantIds)));
      for (const t of tenantRows) tenantMap.set(t.id, { fullName: t.fullName, email: t.email, profileId: t.profileId });
    }

    const unitLabelMap = new Map<string, string>();
    if (unitIds.length > 0) {
      const unitRows = await db
        .select({ id: units.id, label: units.label })
        .from(units)
        .where(inArray(units.id, unitIds));
      for (const u of unitRows) unitLabelMap.set(u.id, u.label ?? u.id);
    }

    for (const contract of contractRows) {
      const tenant = tenantMap.get(contract.tenantId ?? '');
      if (!tenant?.email) continue;

      // Dedup check
      const existing = await db
        .select({ id: reminders.id })
        .from(reminders)
        .where(and(
          eq(reminders.orgId, orgId),
          eq(reminders.type, 'lease_renewal'),
          eq(reminders.targetType, 'contract'),
          eq(reminders.targetId, contract.id),
          eq(reminders.scheduledFor, today),
          inArray(reminders.status, ['sent', 'scheduled']),
        ))
        .limit(1);

      if (existing.length > 0) continue;

      const daysLeft = daysBetween(today, contract.endDate ?? today);
      const unitLabel = unitLabelMap.get(contract.unitId ?? '') ?? 'your unit';
      const message = `Your lease for ${unitLabel} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${contract.endDate}). Please contact your landlord to discuss renewal.`;

      const { subject, html } = buildReminderEmail({
        recipientName: tenant.fullName ?? 'Tenant',
        type: 'lease_renewal',
        message,
        siteUrl,
      });

      const emailResult = await sendEmail({ to: tenant.email, subject, html, context: 'lease_renewal' });

      const [reminder] = await db
        .insert(reminders)
        .values({
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
        })
        .returning({ id: reminders.id });

      if (reminder && tenant.profileId) {
        await db.insert(notificationInbox).values({
          orgId,
          profileId: tenant.profileId,
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
    const chargeRows = await db
      .select({
        id:          charges.id,
        amount:      charges.amount,
        dueDate:     charges.dueDate,
        description: charges.description,
        tenantId:    charges.tenantId,
      })
      .from(charges)
      .where(and(
        eq(charges.orgId, orgId),
        gte(charges.dueDate, today),
        lte(charges.dueDate, paymentCutoff),
      ))
      .orderBy(charges.dueDate)
      .limit(PAGE_SIZE)
      .offset(chargeOffset);

    if (!chargeRows || chargeRows.length === 0) break;
    chargeOffset += chargeRows.length;
    chargesProcessed += chargeRows.length;

    const tenantIds2 = chargeRows.map((c) => c.tenantId).filter(Boolean) as string[];
    const tenantMap2 = new Map<string, { fullName: string | null; email: string | null; profileId: string | null }>();
    if (tenantIds2.length > 0) {
      const tenantRows2 = await db
        .select({ id: tenants.id, fullName: tenants.fullName, email: tenants.email, profileId: tenants.profileId })
        .from(tenants)
        .where(and(eq(tenants.orgId, orgId), inArray(tenants.id, tenantIds2)));
      for (const t of tenantRows2) tenantMap2.set(t.id, { fullName: t.fullName, email: t.email, profileId: t.profileId });
    }

    for (const charge of chargeRows) {
      const tenant = tenantMap2.get(charge.tenantId ?? '');
      if (!tenant?.email) continue;

      const existing = await db
        .select({ id: reminders.id })
        .from(reminders)
        .where(and(
          eq(reminders.orgId, orgId),
          eq(reminders.type, 'payment_due'),
          eq(reminders.targetType, 'charge'),
          eq(reminders.targetId, charge.id),
          eq(reminders.scheduledFor, today),
          inArray(reminders.status, ['sent', 'scheduled']),
        ))
        .limit(1);

      if (existing.length > 0) continue;

      const message = `A payment of $${charge.amount} is due on ${charge.dueDate}${charge.description ? ` (${charge.description})` : ''}. Please log in to your portal to make your payment.`;

      const { subject, html } = buildReminderEmail({
        recipientName: tenant.fullName ?? 'Tenant',
        type: 'payment_due',
        message,
        siteUrl,
      });

      const emailResult = await sendEmail({ to: tenant.email, subject, html, context: 'payment_due' });

      const [reminder] = await db
        .insert(reminders)
        .values({
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
        })
        .returning({ id: reminders.id });

      if (reminder && tenant.profileId) {
        await db.insert(notificationInbox).values({
          orgId,
          profileId: tenant.profileId,
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
    const taskRows = await db
      .select({
        id:       tenantTasks.id,
        title:    tenantTasks.title,
        taskType: tenantTasks.taskType,
        dueAt:    tenantTasks.dueAt,
        status:   tenantTasks.status,
        tenantId: tenantTasks.tenantId,
      })
      .from(tenantTasks)
      .where(and(
        eq(tenantTasks.orgId, orgId),
        inArray(tenantTasks.status, ['pending', 'in_progress']),
      ))
      .orderBy(tenantTasks.dueAt)
      .limit(PAGE_SIZE)
      .offset(taskOffset);

    if (!taskRows || taskRows.length === 0) break;
    taskOffset += taskRows.length;

    const taskTenantIds = taskRows.map((t) => t.tenantId).filter(Boolean) as string[];
    const taskTenantMap = new Map<string, {
      id: string; fullName: string | null; email: string | null; profileId: string | null;
      preferredLanguage: string | null; whatsappPhone: string | null; whatsappOptIn: boolean;
    }>();
    if (taskTenantIds.length > 0) {
      const taskTenantRows = await db
        .select({
          id: tenants.id,
          fullName: tenants.fullName,
          email: tenants.email,
          profileId: tenants.profileId,
          preferredLanguage: tenants.preferredLanguage,
          whatsappPhone: tenants.whatsappPhone,
          whatsappOptIn: tenants.whatsappOptIn,
        })
        .from(tenants)
        .where(and(eq(tenants.orgId, orgId), inArray(tenants.id, taskTenantIds)));
      for (const t of taskTenantRows) {
        taskTenantMap.set(t.id, {
          id: t.id,
          fullName: t.fullName,
          email: t.email,
          profileId: t.profileId,
          preferredLanguage: t.preferredLanguage,
          whatsappPhone: t.whatsappPhone,
          whatsappOptIn: t.whatsappOptIn ?? false,
        });
      }
    }

    const now = new Date().toISOString();

    for (const task of taskRows) {
      const tenant = taskTenantMap.get(task.tenantId ?? '');
      if (!tenant) continue;

      const dueAt = task.dueAt ? (task.dueAt instanceof Date ? task.dueAt : new Date(task.dueAt)) : null;

      // Check if task is expired
      if (dueAt && dueAt.toISOString() < now && task.status === 'pending') {
        await db
          .update(tenantTasks)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(tenantTasks.id, task.id));

        emit('task.expired', {
          orgId,
          taskId: task.id,
          tenantId: tenant.id,
        }, `task.expired:${task.id}`);

        continue;
      }

      if (!dueAt) continue;
      const dueInHours = (dueAt.getTime() - Date.now()) / (60 * 60 * 1000);
      if (dueInHours > 0 && dueInHours <= TASK_REMINDER_HOURS) {
        const existing = await db
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

        if (existing.length > 0) continue;

        const locale = tenant.preferredLanguage ?? 'es';
        const dueDate = dueAt.toLocaleDateString();
        const body = buildWhatsAppTemplate('taskReminder', locale, {
          title: task.title,
          date: dueDate,
        });

        let reminderStatus: 'sent' | 'failed' = 'failed';

        if (tenant.whatsappPhone && tenant.whatsappOptIn) {
          const provider = getWhatsAppProvider();
          const sendResult = await provider.sendMessage(orgId, {
            to: tenant.whatsappPhone,
            body,
          });

          if (sendResult.success && sendResult.providerMessageId) {
            const convId = await upsertConversation({
              orgId,
              externalPhone: tenant.whatsappPhone,
              tenantId: tenant.id,
            }).catch(() => null);

            if (convId) {
              await insertMessage({
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

        await db.insert(reminders).values({
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
