/**
 * Data-fetch helpers for the Admin Portal Preview tab.
 *
 * Security rules applied to every query:
 *   1. Defense-in-depth: every query includes eq(table.orgId, orgId).
 *   2. Auth: callers must pass orgId from requireAdmin() ctx — never from client params.
 *   3. Profile-keyed helpers (notifications, AI sessions) return [] immediately when
 *      profileId is null (tenant has not activated portal account — IC5).
 *   4. No reference to internal_notes anywhere in this file (AC11).
 *   5. All rows are read-only — no INSERT / UPDATE / DELETE in this module.
 *
 * Migrated from Supabase to Drizzle ORM (W5).
 */

import { db } from '@/lib/db';
import {
  visitorLogs,
  notificationInbox,
  announcements,
  aiChatMessages,
  payments,
  incidents,
} from '@/lib/db/schema';
import { eq, and, desc, isNotNull, lte, or, gt, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type {
  PortalPreviewVisitor,
  PortalPreviewNotification,
  PortalPreviewAnnouncement,
  PortalPreviewPayment,
  PortalPreviewIncident,
  AISession,
} from './types';
import { groupAISessions } from './group-ai-sessions';

const VISITORS_LIMIT = 50;
const NOTIFICATIONS_LIMIT = 100;
const ANNOUNCEMENTS_LIMIT = 50;
const RECENT_PAYMENTS_LIMIT = 3;
const RECENT_INCIDENTS_LIMIT = 3;
const AI_MESSAGES_LIMIT = 500;

// ─── AC7: Visitor query — scoped to host_tenant_id + org_id ───────────────────

export async function getPortalPreviewVisitors(
  tenantId: string,
  orgId: string
): Promise<PortalPreviewVisitor[]> {
  try {
    const rows = await db
      .select({
        id:           visitorLogs.id,
        visitorName:  visitorLogs.visitorName,
        purpose:      visitorLogs.purpose,
        visitDate:    visitorLogs.visitDate,
        entryTime:    visitorLogs.entryTime,
        exitTime:     visitorLogs.exitTime,
        hostTenantId: visitorLogs.hostTenantId,
        unitId:       visitorLogs.unitId,
        orgId:        visitorLogs.orgId,
      })
      .from(visitorLogs)
      .where(and(eq(visitorLogs.hostTenantId, tenantId), eq(visitorLogs.orgId, orgId)))
      .orderBy(desc(visitorLogs.entryTime))
      .limit(VISITORS_LIMIT);

    return rows.map((r) => ({
      id:           r.id,
      visitor_name: r.visitorName,
      purpose:      r.purpose ?? null,
      visit_date:   r.visitDate ? String(r.visitDate) : '',
      entry_time:   r.entryTime ? String(r.entryTime) : null,
      exit_time:    r.exitTime  ? String(r.exitTime)  : null,
      host_tenant_id: r.hostTenantId ?? null,
      unit_id:      r.unitId ?? null,
      org_id:       r.orgId,
    })) as PortalPreviewVisitor[];
  } catch (err) {
    console.error('[getPortalPreviewVisitors] query error:', (err as Error).message);
    return [];
  }
}

// ─── AC8: Notification query — scoped to profile_id + org_id ─────────────────

export async function getPortalPreviewNotifications(
  profileId: string | null,
  orgId: string
): Promise<PortalPreviewNotification[]> {
  if (profileId === null) return [];

  try {
    const rows = await db
      .select({
        id:        notificationInbox.id,
        title:     notificationInbox.title,
        body:      notificationInbox.body,
        createdAt: notificationInbox.createdAt,
        readAt:    notificationInbox.readAt,
        profileId: notificationInbox.profileId,
        orgId:     notificationInbox.orgId,
      })
      .from(notificationInbox)
      .where(and(eq(notificationInbox.profileId, profileId), eq(notificationInbox.orgId, orgId)))
      .orderBy(desc(notificationInbox.createdAt))
      .limit(NOTIFICATIONS_LIMIT);

    return rows.map((r) => ({
      id:         r.id,
      title:      r.title,
      body:       r.body,
      created_at: r.createdAt ? String(r.createdAt) : '',
      read_at:    r.readAt    ? String(r.readAt)    : null,
      profile_id: r.profileId,
      org_id:     r.orgId,
    })) as PortalPreviewNotification[];
  } catch (err) {
    console.error('[getPortalPreviewNotifications] query error:', (err as Error).message);
    return [];
  }
}

// ─── AC9: Announcement query — mirrors tenant audience logic ──────────────────

export async function getPortalPreviewAnnouncements(
  tenantUnitId: string | null,
  tenantPropertyId: string | null,
  orgId: string
): Promise<PortalPreviewAnnouncement[]> {
  const now = new Date();

  try {
    const rows = await db
      .select({
        id:          announcements.id,
        title:       announcements.title,
        body:        announcements.body,
        audience:    announcements.audience,
        publishedAt: announcements.publishedAt,
        expiresAt:   announcements.expiresAt,
        unitId:      announcements.unitId,
        propertyId:  announcements.propertyId,
        orgId:       announcements.orgId,
      })
      .from(announcements)
      .where(and(
        eq(announcements.orgId, orgId),
        isNotNull(announcements.publishedAt),
        lte(announcements.publishedAt, now),
        or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
        // Audience filter: 'all' OR (unit match) OR (property match)
        or(
          eq(announcements.audience, 'all'),
          tenantUnitId
            ? and(eq(announcements.audience, 'unit'), eq(announcements.unitId, tenantUnitId))
            : sql`false`,
          tenantPropertyId
            ? and(eq(announcements.audience, 'property'), eq(announcements.propertyId, tenantPropertyId))
            : sql`false`,
        ),
      ))
      .orderBy(desc(announcements.publishedAt))
      .limit(ANNOUNCEMENTS_LIMIT);

    return rows.map((r) => ({
      id:           r.id,
      title:        r.title,
      body:         r.body,
      audience:     r.audience as 'all' | 'property' | 'unit',
      published_at: r.publishedAt ? String(r.publishedAt) : null,
      expires_at:   r.expiresAt   ? String(r.expiresAt)   : null,
      unit_id:      r.unitId     ?? null,
      property_id:  r.propertyId ?? null,
      org_id:       r.orgId,
    })) as PortalPreviewAnnouncement[];
  } catch (err) {
    console.error('[getPortalPreviewAnnouncements] query error:', (err as Error).message);
    return [];
  }
}

// ─── AC10: AI session query — grouped by session_id ──────────────────────────

export async function getPortalPreviewAISessions(
  profileId: string | null,
  orgId: string
): Promise<AISession[]> {
  if (profileId === null) return [];

  try {
    const rows = await db
      .select({
        id:        aiChatMessages.id,
        sessionId: aiChatMessages.sessionId,
        role:      aiChatMessages.role,
        content:   aiChatMessages.content,
        createdAt: aiChatMessages.createdAt,
        profileId: aiChatMessages.profileId,
        orgId:     aiChatMessages.orgId,
      })
      .from(aiChatMessages)
      .where(and(eq(aiChatMessages.profileId, profileId), eq(aiChatMessages.orgId, orgId)))
      .orderBy(desc(aiChatMessages.createdAt))
      .limit(AI_MESSAGES_LIMIT);

    // groupAISessions expects snake_case shape from legacy Supabase types
    const shaped = rows.map((r) => ({
      id:         r.id,
      session_id: r.sessionId,
      role:       r.role,
      content:    r.content,
      created_at: r.createdAt ? String(r.createdAt) : '',
      profile_id: r.profileId,
      org_id:     r.orgId,
    }));

    return groupAISessions(shaped as never);
  } catch (err) {
    console.error('[getPortalPreviewAISessions] query error:', (err as Error).message);
    return [];
  }
}

// ─── B2: Recent payments — for portal home preview ────────────────────────────

export async function getPortalPreviewRecentPayments(
  tenantId: string,
  orgId: string
): Promise<PortalPreviewPayment[]> {
  try {
    const rows = await db
      .select({
        id:     payments.id,
        amount: payments.amount,
        paidAt: payments.paidAt,
        status: payments.status,
        method: payments.method,
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.orgId, orgId)))
      .orderBy(desc(payments.paidAt))
      .limit(RECENT_PAYMENTS_LIMIT);

    return rows.map((r) => ({
      id:      r.id,
      amount:  Number(r.amount),
      paid_at: r.paidAt ? String(r.paidAt) : null,
      status:  r.status,
      method:  r.method,
    })) as PortalPreviewPayment[];
  } catch (err) {
    console.error('[getPortalPreviewRecentPayments] query error:', (err as Error).message);
    return [];
  }
}

// ─── B2: Recent incidents — for portal home preview ──────────────────────────

export async function getPortalPreviewRecentIncidents(
  tenantId: string,
  orgId: string
): Promise<PortalPreviewIncident[]> {
  try {
    const rows = await db
      .select({
        id:        incidents.id,
        title:     incidents.title,
        status:    incidents.status,
        createdAt: incidents.createdAt,
      })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.orgId, orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(RECENT_INCIDENTS_LIMIT);

    return rows.map((r) => ({
      id:         r.id,
      title:      r.title,
      status:     r.status,
      created_at: r.createdAt ? String(r.createdAt) : '',
    })) as PortalPreviewIncident[];
  } catch (err) {
    console.error('[getPortalPreviewRecentIncidents] query error:', (err as Error).message);
    return [];
  }
}
