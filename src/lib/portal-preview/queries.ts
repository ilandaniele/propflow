/**
 * Data-fetch helpers for the Admin Portal Preview tab.
 *
 * Security rules applied to every query:
 *   1. Defense-in-depth: every query chains .eq('org_id', orgId) in addition to RLS.
 *   2. Auth: callers must pass orgId from requireAdmin() ctx — never from client params.
 *   3. Profile-keyed helpers (notifications, AI sessions) return [] immediately when
 *      profileId is null (tenant has not activated portal account — IC5).
 *   4. No reference to internal_notes anywhere in this file (AC11).
 *   5. All rows are read-only — no INSERT / UPDATE / DELETE in this module.
 *
 * Column shapes verified against migrations:
 *   visitor_logs      (migration 000014): id, org_id, property_id, unit_id, visitor_name,
 *                     host_tenant_id, visit_date, entry_time, exit_time, purpose, created_by
 *   notification_inbox (migration 000013): id, org_id, profile_id, type, title, body,
 *                     related_type, related_id, read_at, created_at
 *   announcements     (migration 000012): id, org_id, created_by, title, body, audience,
 *                     property_id, unit_id, published_at, expires_at, created_at
 *                     NOTE: no 'status' column — published state = published_at IS NOT NULL
 *                     AND published_at <= now()
 *   ai_chat_messages  (migration 000014): id, org_id, profile_id, session_id (uuid NOT NULL),
 *                     role, content, created_at
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PortalPreviewVisitor,
  PortalPreviewNotification,
  PortalPreviewAnnouncement,
  AISession,
} from './types';
import { groupAISessions } from './group-ai-sessions';

const QUERY_LIMIT = 20;
const AI_MESSAGES_LIMIT = 500;

// ─── AC7: Visitor query — scoped to host_tenant_id + org_id ───────────────────

/**
 * Fetch visitor_logs for a given tenant (host_tenant_id) in an org.
 * Ordered by entry_time DESC (null entry_times sort last via Supabase nullsLast).
 * Limited to QUERY_LIMIT rows for the preview panel.
 *
 * AC7: uses .eq('host_tenant_id', tenantId) AND .eq('org_id', orgId).
 */
export async function getPortalPreviewVisitors(
  supabase: SupabaseClient,
  tenantId: string,
  orgId: string
): Promise<PortalPreviewVisitor[]> {
  const { data, error } = await supabase
    .from('visitor_logs')
    .select('id, visitor_name, purpose, visit_date, entry_time, exit_time, host_tenant_id, unit_id, org_id')
    .eq('host_tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('entry_time', { ascending: false, nullsFirst: false })
    .limit(QUERY_LIMIT);

  if (error) {
    console.error('[getPortalPreviewVisitors] query error:', error.code);
    return [];
  }

  return (data ?? []) as PortalPreviewVisitor[];
}

// ─── AC8: Notification query — scoped to profile_id + org_id ─────────────────

/**
 * Fetch notification_inbox for a given profile in an org.
 * Returns [] immediately when profileId is null (no portal account linked — IC5).
 * Ordered by created_at DESC, matching /portal/notifications sort order.
 *
 * AC8: uses .eq('profile_id', profileId) AND .eq('org_id', orgId).
 */
export async function getPortalPreviewNotifications(
  supabase: SupabaseClient,
  profileId: string | null,
  orgId: string
): Promise<PortalPreviewNotification[]> {
  if (profileId === null) {
    return [];
  }

  const { data, error } = await supabase
    .from('notification_inbox')
    .select('id, title, body, created_at, read_at, profile_id, org_id')
    .eq('profile_id', profileId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(QUERY_LIMIT);

  if (error) {
    console.error('[getPortalPreviewNotifications] query error:', error.code);
    return [];
  }

  return (data ?? []) as PortalPreviewNotification[];
}

// ─── AC9: Announcement query — mirrors tenant audience logic ──────────────────

/**
 * Fetch announcements visible to a tenant given their unit_id and property_id.
 *
 * Mirrors the tenant RLS policy for announcements (migration 000015):
 *   - published_at IS NOT NULL AND published_at <= now()
 *   - (expires_at IS NULL OR expires_at > now())
 *   - audience = 'all'
 *     OR (audience = 'unit' AND unit_id = tenantUnitId)
 *     OR (audience = 'property' AND property_id = tenantPropertyId)
 *
 * NOTE: announcements has no 'status' column — published state is determined
 * solely by published_at. The spec mentions status='published' but the actual
 * schema uses published_at IS NOT NULL AND published_at <= now() (verified in
 * migration 000012 and 000015 RLS policy).
 *
 * AC9: audience filter matches what the tenant sees at /portal/announcements.
 */
export async function getPortalPreviewAnnouncements(
  supabase: SupabaseClient,
  tenantUnitId: string | null,
  tenantPropertyId: string | null,
  orgId: string
): Promise<PortalPreviewAnnouncement[]> {
  const now = new Date().toISOString();

  // Build the audience filter using Supabase's .or() with nested conditions.
  // Mirrors: audience='all' OR (audience='unit' AND unit_id=X) OR (audience='property' AND property_id=Y)
  const audienceParts: string[] = ['audience.eq.all'];

  if (tenantUnitId) {
    audienceParts.push(`and(audience.eq.unit,unit_id.eq.${tenantUnitId})`);
  }
  if (tenantPropertyId) {
    audienceParts.push(`and(audience.eq.property,property_id.eq.${tenantPropertyId})`);
  }

  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, audience, published_at, expires_at, unit_id, property_id, org_id')
    .eq('org_id', orgId)
    .not('published_at', 'is', null)
    .lte('published_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .or(audienceParts.join(','))
    .order('published_at', { ascending: false })
    .limit(QUERY_LIMIT);

  if (error) {
    console.error('[getPortalPreviewAnnouncements] query error:', error.code);
    return [];
  }

  return (data ?? []) as PortalPreviewAnnouncement[];
}

// ─── AC10: AI session query — grouped by session_id ──────────────────────────

/**
 * Fetch ai_chat_messages for a given profile in an org, then group them into
 * AISession[] by session_id.
 *
 * Returns [] immediately when profileId is null (no portal account linked — IC5).
 * Fetches up to AI_MESSAGES_LIMIT messages (newest first) then groups in memory
 * via groupAISessions(). Returns up to 10 sessions (SESSION_LIMIT in groupAISessions).
 *
 * session_id is uuid NOT NULL in the DB (migration 000014), so no fallback grouping needed.
 *
 * AC10: uses .eq('profile_id', profileId) AND .eq('org_id', orgId).
 */
export async function getPortalPreviewAISessions(
  supabase: SupabaseClient,
  profileId: string | null,
  orgId: string
): Promise<AISession[]> {
  if (profileId === null) {
    return [];
  }

  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('id, session_id, role, content, created_at, profile_id, org_id')
    .eq('profile_id', profileId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(AI_MESSAGES_LIMIT);

  if (error) {
    console.error('[getPortalPreviewAISessions] query error:', error.code);
    return [];
  }

  return groupAISessions(data ?? []);
}
