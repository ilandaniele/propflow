/**
 * Shared visit-scheduling types (Phase 3-4, item A). This module has no
 * runtime deps — B, C and D import only types + the two exported constants
 * from here.
 */

export type VisitStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';

export const ACTIVE_VISIT_STATUSES = ['scheduled', 'confirmed'] as const;

/** Constant for now — promoted to agent_configs in Phase 9. */
export const MAX_ACTIVE_VISITS_PER_PHONE = 2;

export type VisitFeedback = 'interested' | 'not_interested' | 'wants_more';

/** Half-open interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  profileId: string;
  startsAt: Date;
  endsAt: Date;
  bufferMinutes: number;
}

export interface VisitRecord {
  id: string;
  orgId: string;
  leadId: string;
  listingId: string | null;
  profileId: string;
  sessionId: string | null;
  contactPhone: string | null;
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
  status: VisitStatus;
  createdBy: 'agent' | 'human';
  sourceChannel: 'whatsapp' | 'web' | 'voice' | 'manual';
  rescheduledFromId: string | null;
  feedback: VisitFeedback | null;
  notes: string | null;
  // Denormalized for display, via join — not authoritative.
  listingTitle: string | null;
  advisorName: string | null;
  leadName: string | null;
}
