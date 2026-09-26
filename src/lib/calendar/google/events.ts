/**
 * Google Calendar event CRUD + the event body builder. Everything written
 * to Google goes through sanitizeForCalendar — no phone, notes or lead free
 * text ever leaves PropFlow (blueprint §10 security checklist).
 */

import { createHash } from 'node:crypto';
import type { VisitRecord } from '@/lib/agent/visits/types';
import { googleFetch } from './client';
import { GoogleApiError } from '../types';

// ─── Deterministic event id ─────────────────────────────────────────────────

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

function toBase32Hex(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 0x1f];
  return out;
}

/** Deterministic per visit -> idempotent insert (a retried push reuses the same Google event id instead of creating a duplicate). Matches Google's event-id charset [a-v0-9], 5-1024 chars. */
export function eventIdForVisit(visitId: string): string {
  const hash = createHash('sha1').update(visitId).digest();
  return `pfv${toBase32Hex(hash)}`;
}

// ─── Sanitization ────────────────────────────────────────────────────────────

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const HTML_UNSAFE_RE = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Google renders the event description as HTML — escape it so lead/free-text input can never inject markup. */
export function sanitizeForCalendar(s: string | null | undefined, max: number): string {
  if (!s) return '';
  const stripped = s.replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim();
  const capped = stripped.length > max ? stripped.slice(0, max).trim() : stripped;
  return capped.replace(HTML_UNSAFE_RE, (c) => HTML_ESCAPES[c]);
}

// ─── Event body ──────────────────────────────────────────────────────────────

export interface GoogleEventBody {
  id?: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { pfVisitId: string; pfOrgId: string } };
  transparency: 'opaque';
  reminders: { useDefault: true };
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Completada',
  no_show: 'No se presentó',
  cancelled: 'Cancelada',
  rescheduled: 'Reprogramada',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildVisitEvent(v: VisitRecord, a: { timeZone: string; dashboardUrl: string; includeId: boolean }): GoogleEventBody {
  const summary = sanitizeForCalendar(`Visita: ${v.listingTitle || 'Propiedad'}`, 120);
  const leadName = sanitizeForCalendar(v.leadName || 'Lead', 80);
  const statusLabel = STATUS_LABEL[v.status] ?? v.status;
  const description = [
    `${leadName} — ${statusLabel}`,
    `${a.dashboardUrl}/dashboard/visits?week=${isoDate(v.startsAt)}`,
  ].join('\n');

  const body: GoogleEventBody = {
    summary,
    description,
    start: { dateTime: v.startsAt.toISOString(), timeZone: a.timeZone },
    end: { dateTime: v.endsAt.toISOString(), timeZone: a.timeZone },
    extendedProperties: { private: { pfVisitId: v.id, pfOrgId: v.orgId } },
    transparency: 'opaque',
    reminders: { useDefault: true },
  };
  if (a.includeId) body.id = eventIdForVisit(v.id);
  return body;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

interface GoogleEventRaw {
  id: string;
  etag: string;
}

export async function insertEvent(connId: string, calId: string, body: GoogleEventBody): Promise<{ id: string; etag: string }> {
  try {
    const res = await googleFetch<GoogleEventRaw>(connId, `/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      query: { sendUpdates: 'none' },
      body,
    });
    return { id: res.id, etag: res.etag };
  } catch (e) {
    // The event id is deterministic (eventIdForVisit) — a 409 means a prior
    // attempt already created it, so patch instead of creating a duplicate.
    if (e instanceof GoogleApiError && e.status === 409 && body.id) {
      return patchEvent(connId, calId, body.id, body);
    }
    throw e;
  }
}

export async function patchEvent(
  connId: string,
  calId: string,
  eventId: string,
  body: Partial<GoogleEventBody>,
): Promise<{ id: string; etag: string }> {
  const res = await googleFetch<GoogleEventRaw>(connId, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    query: { sendUpdates: 'none' },
    body,
  });
  return { id: res.id, etag: res.etag };
}

export async function deleteEvent(connId: string, calId: string, eventId: string): Promise<void> {
  try {
    await googleFetch<void>(connId, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      query: { sendUpdates: 'none' },
    });
  } catch (e) {
    // Already gone on Google's side — deleting an already-deleted event is a success, not an error.
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

export interface GoogleEventItem {
  id: string;
  etag?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: { pfVisitId?: string; pfOrgId?: string } };
}

interface ListEventsResponse {
  items?: GoogleEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export async function listEventsPage(
  connId: string,
  calId: string,
  a: { syncToken?: string | null; pageToken?: string | null; timeMin?: Date },
): Promise<{ items: GoogleEventItem[]; nextPageToken: string | null; nextSyncToken: string | null }> {
  // showDeleted + singleEvents=true; NO privateExtendedProperty, and timeMin only
  // when there's no syncToken yet (initial/post-410 full sync) — both timeMin and
  // privateExtendedProperty are incompatible with syncToken (Google API constraint).
  const query: Record<string, string | undefined> = {
    showDeleted: 'true',
    singleEvents: 'true',
    maxResults: '250',
  };
  if (a.pageToken) query.pageToken = a.pageToken;
  else if (a.syncToken) query.syncToken = a.syncToken;
  else if (a.timeMin) query.timeMin = a.timeMin.toISOString();

  const res = await googleFetch<ListEventsResponse>(connId, `/calendars/${encodeURIComponent(calId)}/events`, { query });

  return {
    items: res.items ?? [],
    nextPageToken: res.nextPageToken ?? null,
    nextSyncToken: res.nextSyncToken ?? null,
  };
}
