/**
 * Weekly QA export — handoffs and complaints (Phase 5-6, item G).
 *
 * One qa_exports row per (org, ISO-ish week), Monday-anchored in the org's
 * local timezone. UNIQUE(org_id, week_start) makes generateWeeklyQaExport()
 * idempotent: a second run for the same week returns 'exists' and never
 * re-emails. A "complaint" is an agent_events row with kind='handoff' and
 * data.reason='complaint'; a "takeover" is every handoff plus mode_change
 * events with data.to='human' (manual takeovers) — see blueprint §0.12.
 */

import { db } from '@/lib/db';
import {
  agentEvents,
  agentSessions,
  crmLeads,
  profiles,
  whatsappMessages,
  qaExports,
  organizations,
} from '@/lib/db/schema';
import { and, asc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { localDateParts, zonedWallTimeToUtc } from '@/lib/agent/visits/slots';
import { sendEmail } from '@/lib/notifications/email';
import { log } from '@/lib/log';

export interface QaRow {
  occurredAt: Date;
  kind: 'handoff' | 'takeover';
  reason: string;
  isComplaint: boolean;
  summary: string | null;
  sessionId: string;
  channel: string;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadStage: string | null;
  advisorName: string | null;
  agentTurns: number;
  firstHumanReplyMinutes: number | null;
}

// Weekly volume for a single org is expected to be a handful of rows — this
// cap only guards a pathological org from blowing up the CSV/email.
const QA_EXPORT_ROW_CAP = 5000;
const QA_EMAIL_TOP_ROWS = 20;

/**
 * The most recently *completed* Monday-to-Monday week, in `timeZone`.
 * If `now` falls on a local Monday, that day is the exclusive end — the
 * range never includes any part of the still-running week.
 */
export function previousWeekRange(now: Date, timeZone: string): { weekStart: string; periodStart: Date; periodEnd: Date } {
  const p = localDateParts(now, timeZone);
  const isoWeekday = p.weekday === 0 ? 7 : p.weekday; // 1=Mon..7=Sun

  // Pure calendar arithmetic (no timezone conversion here) to find the local
  // calendar date of this week's Monday and last week's Monday.
  const calendarNow = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const currentMonday = new Date(calendarNow.getTime() - (isoWeekday - 1) * 86_400_000);
  const prevMonday = new Date(currentMonday.getTime() - 7 * 86_400_000);

  const periodStart = zonedWallTimeToUtc(
    prevMonday.getUTCFullYear(), prevMonday.getUTCMonth() + 1, prevMonday.getUTCDate(), 0, timeZone,
  );
  const periodEnd = zonedWallTimeToUtc(
    currentMonday.getUTCFullYear(), currentMonday.getUTCMonth() + 1, currentMonday.getUTCDate(), 0, timeZone,
  );
  const weekStart = `${prevMonday.getUTCFullYear()}-${String(prevMonday.getUTCMonth() + 1).padStart(2, '0')}-${String(prevMonday.getUTCDate()).padStart(2, '0')}`;

  return { weekStart, periodStart, periodEnd };
}

/** First `whatsapp_messages` row with sender_kind='human' strictly after `after`, in minutes. */
async function firstHumanReplyAfter(conversationId: string, after: Date): Promise<number | null> {
  const rows = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(and(
      eq(whatsappMessages.conversationId, conversationId),
      eq(whatsappMessages.senderKind, 'human'),
      sql`${whatsappMessages.createdAt} > ${after}`,
    ))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return Math.round((row.createdAt.getTime() - after.getTime()) / 60_000);
}

/**
 * agent_events kind='handoff' OR (kind='mode_change' AND data->>'to'='human'),
 * joined to the session/lead/advisor. Capped at QA_EXPORT_ROW_CAP rows.
 */
export async function collectQaRows(orgId: string, from: Date, to: Date): Promise<QaRow[]> {
  const eventRows = await db
    .select({
      kind: agentEvents.kind,
      data: agentEvents.data,
      createdAt: agentEvents.createdAt,
      sessionId: agentSessions.id,
      channel: agentSessions.channel,
      whatsappConversationId: agentSessions.whatsappConversationId,
      agentTurnCount: agentSessions.agentTurnCount,
      leadId: crmLeads.id,
      leadName: crmLeads.fullName,
      leadPhone: crmLeads.phone,
      leadStage: crmLeads.stage,
      advisorName: profiles.fullName,
    })
    .from(agentEvents)
    .innerJoin(agentSessions, eq(agentSessions.id, agentEvents.sessionId))
    .leftJoin(crmLeads, eq(crmLeads.id, agentSessions.leadId))
    .leftJoin(profiles, eq(profiles.id, crmLeads.assignedProfileId))
    .where(and(
      eq(agentEvents.orgId, orgId),
      gte(agentEvents.createdAt, from),
      lt(agentEvents.createdAt, to),
      or(
        eq(agentEvents.kind, 'handoff'),
        and(eq(agentEvents.kind, 'mode_change'), sql`${agentEvents.data} ->> 'to' = 'human'`),
      ),
    ))
    .orderBy(asc(agentEvents.createdAt))
    .limit(QA_EXPORT_ROW_CAP);

  const rows: QaRow[] = [];
  for (const r of eventRows) {
    const data = (r.data as Record<string, unknown>) ?? {};
    const isHandoff = r.kind === 'handoff';
    const reason = isHandoff ? String(data.reason ?? 'unknown') : 'manual_takeover';
    const firstHumanReplyMinutes = r.whatsappConversationId
      ? await firstHumanReplyAfter(r.whatsappConversationId, r.createdAt)
      : null;

    rows.push({
      occurredAt: r.createdAt,
      kind: isHandoff ? 'handoff' : 'takeover',
      reason,
      isComplaint: isHandoff && data.reason === 'complaint',
      summary: typeof data.summary === 'string' ? data.summary : null,
      sessionId: r.sessionId,
      channel: r.channel,
      leadId: r.leadId,
      leadName: r.leadName,
      leadPhone: r.leadPhone,
      leadStage: r.leadStage,
      advisorName: r.advisorName,
      agentTurns: r.agentTurnCount,
      firstHumanReplyMinutes,
    });
  }
  return rows;
}

const CSV_HEADER = [
  'occurred_at', 'kind', 'reason', 'is_complaint', 'summary', 'session_id', 'channel',
  'lead_id', 'lead_name', 'lead_phone', 'lead_stage', 'advisor_name', 'agent_turns',
  'first_human_reply_minutes',
];

// Cells starting with these characters can trigger formula execution when the
// CSV is opened in Excel/Sheets ("formula injection") — prefix with a literal
// quote so they are read back as text.
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function escapeCsvCell(raw: string): string {
  let cell = raw;
  if (FORMULA_PREFIX_RE.test(cell)) cell = `'${cell}`;
  if (/["\r\n]/.test(cell) || cell.includes(',')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function formatCsvDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

/** RFC 4180 CSV, UTF-8 BOM, formula-injection guard. */
export function toCsv(rows: QaRow[], timeZone: string): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    const cells = [
      formatCsvDate(r.occurredAt, timeZone),
      r.kind,
      r.reason,
      r.isComplaint ? 'true' : 'false',
      r.summary ?? '',
      r.sessionId,
      r.channel,
      r.leadId ?? '',
      r.leadName ?? '',
      r.leadPhone ?? '',
      r.leadStage ?? '',
      r.advisorName ?? '',
      String(r.agentTurns),
      r.firstHumanReplyMinutes != null ? String(r.firstHumanReplyMinutes) : '',
    ];
    lines.push(cells.map(escapeCsvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "+51987654321" -> "+51•••••321". Short/empty phones are fully masked. */
function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  if (phone.length <= 6) return '•'.repeat(phone.length);
  return `${phone.slice(0, 3)}•••••${phone.slice(-3)}`;
}

export function buildQaEmail(a: {
  orgName: string;
  weekStart: string;
  counts: { handoffs: number; complaints: number; takeovers: number };
  top: QaRow[];
  dashboardUrl: string;
}): { subject: string; html: string } {
  const subject = `QA semanal — ${a.orgName} — semana del ${a.weekStart}`;

  const rowsHtml = a.top.map((r) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(formatCsvDate(r.occurredAt, 'America/Lima'))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(r.isComplaint ? 'Queja' : r.kind === 'handoff' ? 'Traspaso' : 'Toma manual')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(r.reason)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(r.leadName ?? '—')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(maskPhone(r.leadPhone))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(r.advisorName ?? '—')}</td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="font-size:20px;margin-bottom:8px">QA semanal — ${escapeHtml(a.orgName)}</h1>
  <p>Semana del <strong>${escapeHtml(a.weekStart)}</strong>.</p>
  <p>
    Traspasos: <strong>${a.counts.handoffs}</strong> ·
    Quejas: <strong>${a.counts.complaints}</strong> ·
    Tomas manuales: <strong>${a.counts.takeovers}</strong>
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0">
    <thead>
      <tr style="text-align:left;color:#64748b">
        <th style="padding:4px 8px">Fecha</th><th style="padding:4px 8px">Tipo</th><th style="padding:4px 8px">Motivo</th>
        <th style="padding:4px 8px">Lead</th><th style="padding:4px 8px">Teléfono</th><th style="padding:4px 8px">Asesor</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" style="padding:8px">Sin eventos.</td></tr>'}</tbody>
  </table>
  <p style="margin:24px 0">
    <a href="${escapeHtml(a.dashboardUrl)}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Ver todos en el panel
    </a>
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:32px">
    Reporte automático generado por PropFlow. El CSV completo está disponible en el panel de QA del agente.
  </p>
</body>
</html>`;

  return { subject, html };
}

async function emailAdmins(a: {
  orgId: string;
  exportId: string;
  weekStart: string;
  rows: QaRow[];
  counts: { handoffs: number; complaints: number; takeovers: number };
}): Promise<number> {
  const [orgRow] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, a.orgId)).limit(1);
  const orgName = orgRow?.name ?? 'PropFlow';

  const adminRows = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(and(eq(profiles.orgId, a.orgId), eq(profiles.role, 'admin')));
  const recipients = adminRows
    .map((r) => r.email)
    .filter((e): e is string => typeof e === 'string' && e.length > 0);

  if (recipients.length === 0) {
    log.warn('[agent/qa-export] no admin recipients', { orgId: a.orgId });
    return 0;
  }

  const top = [...a.rows]
    .sort((x, y) => Number(y.isComplaint) - Number(x.isComplaint) || x.occurredAt.getTime() - y.occurredAt.getTime())
    .slice(0, QA_EMAIL_TOP_ROWS);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const { subject, html } = buildQaEmail({
    orgName,
    weekStart: a.weekStart,
    counts: a.counts,
    top,
    dashboardUrl: `${siteUrl}/dashboard/agent/qa`,
  });

  let sent = 0;
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, context: 'qa-export' });
    if (result.success) sent++;
  }

  await db.update(qaExports).set({ emailedAt: new Date(), emailRecipientCount: sent }).where(eq(qaExports.id, a.exportId));
  return sent;
}

/**
 * INSERT ... ON CONFLICT (org_id, week_start) DO NOTHING RETURNING. A second
 * run for the same week never re-emails — this is the idempotency guarantee
 * that also protects the workflow_dispatch manual trigger.
 */
export async function generateWeeklyQaExport(
  orgId: string,
  now: Date = new Date(),
): Promise<{ status: 'created' | 'exists'; exportId: string; rows: number }> {
  const config = await getOrCreateAgentConfig(orgId);
  const timeZone = config.timezone;
  const { weekStart, periodStart, periodEnd } = previousWeekRange(now, timeZone);

  const existing = await db
    .select({ id: qaExports.id, rowCount: qaExports.rowCount })
    .from(qaExports)
    .where(and(eq(qaExports.orgId, orgId), eq(qaExports.weekStart, weekStart)))
    .limit(1);
  if (existing[0]) {
    return { status: 'exists', exportId: existing[0].id, rows: existing[0].rowCount ?? 0 };
  }

  const rows = await collectQaRows(orgId, periodStart, periodEnd);
  const csv = toCsv(rows, timeZone);
  const handoffCount = rows.filter((r) => r.kind === 'handoff').length;
  const complaintCount = rows.filter((r) => r.isComplaint).length;
  const takeoverCount = rows.filter((r) => r.kind === 'takeover').length;

  const inserted = await db
    .insert(qaExports)
    .values({
      orgId,
      weekStart,
      periodStart,
      periodEnd,
      rowCount: rows.length,
      handoffCount,
      complaintCount,
      takeoverCount,
      csv,
    })
    .onConflictDoNothing({ target: [qaExports.orgId, qaExports.weekStart] })
    .returning({ id: qaExports.id });

  if (!inserted[0]) {
    // Lost a race with a concurrent run for the same org/week.
    const raced = await db
      .select({ id: qaExports.id, rowCount: qaExports.rowCount })
      .from(qaExports)
      .where(and(eq(qaExports.orgId, orgId), eq(qaExports.weekStart, weekStart)))
      .limit(1);
    return { status: 'exists', exportId: raced[0]?.id ?? '', rows: raced[0]?.rowCount ?? 0 };
  }

  if (rows.length > 0) {
    await emailAdmins({
      orgId,
      exportId: inserted[0].id,
      weekStart,
      rows,
      counts: { handoffs: handoffCount, complaints: complaintCount, takeovers: takeoverCount },
    }).catch((e) => {
      log.error('[agent/qa-export] email failed', { orgId, error: e instanceof Error ? e.message : 'unknown' });
    });
  }

  return { status: 'created', exportId: inserted[0].id, rows: rows.length };
}

/** Per-org failure isolated — one org's error never blocks the rest. */
export async function runWeeklyQaExports(now: Date = new Date()): Promise<{ orgs: number; created: number; emailed: number; failed: number }> {
  const orgRows = await db.selectDistinct({ orgId: agentSessions.orgId }).from(agentSessions);

  let created = 0;
  let emailed = 0;
  let failed = 0;

  for (const { orgId } of orgRows) {
    try {
      const result = await generateWeeklyQaExport(orgId, now);
      if (result.status === 'created') {
        created++;
        if (result.rows > 0) emailed++;
      }
    } catch (e) {
      failed++;
      log.error('[agent/qa-export] org failed', { orgId, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return { orgs: orgRows.length, created, emailed, failed };
}
