/**
 * Shared types for the Google Calendar integration (Phase 5). Item B (the
 * OAuth/sync engine) and item C (routes/UI) both depend only on this file —
 * neither owns it.
 */

export const CALENDAR_JOB_KINDS = {
  push: 'calendar.push_visit',
  sync: 'calendar.sync',
} as const;

export interface CalendarPushPayload {
  visitId: string;
}

export interface CalendarSyncPayload {
  connectionId: string;
}

/** Requested at OAuth time; both scopes are mandatory (see google/oauth.ts). */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

export type CalendarConnectionStatus = 'active' | 'revoked' | 'error';

export type VisitGoogleSyncStatus = 'none' | 'pending' | 'synced' | 'error' | 'detached' | 'drift';

export interface CalendarConnection {
  id: string;
  orgId: string;
  profileId: string;
  googleEmail: string;
  calendarId: string;
  status: CalendarConnectionStatus;
  freebusyEnabled: boolean;
  writeEvents: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

/** A non-2xx response from the Google Calendar API. */
export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public reason: string | null,
    msg?: string,
  ) {
    super(msg ?? `Google API error ${status}${reason ? ` (${reason})` : ''}`);
    this.name = 'GoogleApiError';
  }
}

/** The refresh token is revoked or otherwise invalid — the connection needs reconnecting. */
export class CalendarAuthError extends Error {
  constructor(msg = 'Google Calendar refresh token is invalid or revoked') {
    super(msg);
    this.name = 'CalendarAuthError';
  }
}
