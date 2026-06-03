/**
 * Types for the Admin Portal Preview tab.
 *
 * All types reflect the actual DB column shapes from the migrations.
 * No internal_notes fields are referenced here (admin-only, never exposed).
 */

// visitor_logs row — scoped to host_tenant_id + org_id for the portal preview
export interface PortalPreviewVisitor {
  id: string;
  visitor_name: string;
  purpose: string | null;
  visit_date: string;
  entry_time: string | null;
  exit_time: string | null;
  host_tenant_id: string | null;
  unit_id: string | null;
  org_id: string;
}

// notification_inbox row — scoped to profile_id + org_id for the portal preview
export interface PortalPreviewNotification {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  profile_id: string;
  org_id: string;
}

// announcements row — audience-filtered subset the tenant would see
// Note: DB uses published_at (not a status column) to determine published state.
export interface PortalPreviewAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'property' | 'unit';
  published_at: string | null;
  expires_at: string | null;
  unit_id: string | null;
  property_id: string | null;
  org_id: string;
}

// payments row — recent payments for portal home preview (limit 3)
export interface PortalPreviewPayment {
  id: string;
  amount: number;
  paid_at: string | null;
  status: string;
  method: string | null;
}

// incidents row — recent incidents for portal home preview (limit 3)
export interface PortalPreviewIncident {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

// ai_chat_messages grouped by session_id — one row per session
export interface AISession {
  session_id: string;
  started_at: string;
  message_count: number;
  /** First 80 chars of the last message where role='user'. Empty string if no user message. */
  last_user_preview: string;
}
