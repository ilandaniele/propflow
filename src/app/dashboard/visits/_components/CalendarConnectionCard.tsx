'use client';

/**
 * CalendarConnectionCard — item C. Shows the signed-in advisor's own Google
 * Calendar connection (status, last sync, freebusy/write-events toggles,
 * Connect/Reconnect/Disconnect) plus a read-only list of the org's other
 * connections (admins can see everyone's status — assumption 5).
 *
 * Data is fetched server-side (src/app/dashboard/visits/availability/page.tsx)
 * and passed in as props, same shape as AvailabilityClient. Connect/Reconnect
 * is a plain <a href="/api/calendar/google/connect"> — not a fetch() call —
 * because the OAuth flow needs a real navigation to set the state cookie and
 * follow Google's redirect.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { disconnectCalendar, resyncCalendarNow, updateCalendarSettings } from '@/app/actions/calendar';

export interface OwnConnection {
  googleEmail: string;
  status: 'active' | 'revoked' | 'error';
  freebusyEnabled: boolean;
  writeEvents: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface OrgConnection {
  id: string;
  profileName: string | null;
  googleEmail: string;
  status: 'active' | 'revoked' | 'error';
  lastSyncedAt: string | null;
}

interface CalendarConnectionCardProps {
  isAdvisor: boolean;
  own: OwnConnection | null;
  orgConnections: OrgConnection[];
  /** ?calendar=connected|error:<code> from the OAuth callback redirect (blueprint §4). */
  calendarParam?: string | null;
}

function statusVariant(status: 'active' | 'revoked' | 'error'): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'revoked') return 'warning';
  return 'danger';
}

export function CalendarConnectionCard({ isAdvisor, own, orgConnections, calendarParam }: CalendarConnectionCardProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [freebusyEnabled, setFreebusyEnabled] = useState(own?.freebusyEnabled ?? true);
  const [writeEvents, setWriteEvents] = useState(own?.writeEvents ?? true);
  const [busy, setBusy] = useState(false);

  // Derived, not effect-driven state: calendarParam is a server-rendered prop
  // (from the OAuth callback redirect's query string), so it's already
  // available on first render — no need to synchronize it after the fact.
  const message =
    calendarParam === 'connected'
      ? t('connected')
      : calendarParam?.startsWith('error:')
        ? calendarParam.slice('error:'.length)
        : null;

  async function handleToggle(field: 'freebusyEnabled' | 'writeEvents', value: boolean) {
    if (field === 'freebusyEnabled') setFreebusyEnabled(value);
    else setWriteEvents(value);
    setBusy(true);
    try {
      await updateCalendarSettings({ [field]: value });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(t('disconnect') + '?')) return;
    setBusy(true);
    try {
      await disconnectCalendar();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function handleResync() {
    setBusy(true);
    try {
      await resyncCalendarNow();
    } finally {
      setBusy(false);
    }
  }

  if (!isAdvisor) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar</CardTitle>
        {own && (
          <Badge variant={statusVariant(own.status)}>
            {own.status === 'active' ? t('connected') : own.status === 'revoked' ? t('statusRevoked') : t('statusError')}
          </Badge>
        )}
      </CardHeader>

      {message && <p className="mb-3 text-sm text-slate-600">{message}</p>}

      {own ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">{own.googleEmail}</p>
          {own.lastSyncedAt && (
            <p className="text-xs text-slate-500">
              {t('lastSync')}: {new Date(own.lastSyncedAt).toLocaleString()}
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={freebusyEnabled}
              disabled={busy}
              onChange={(e) => handleToggle('freebusyEnabled', e.target.checked)}
            />
            {t('freebusyToggle')}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={writeEvents}
              disabled={busy}
              onChange={(e) => handleToggle('writeEvents', e.target.checked)}
            />
            {t('writeEventsToggle')}
          </label>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="sm" disabled={busy} onClick={handleResync}>
              {t('resyncNow')}
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={handleDisconnect}>
              {t('disconnect')}
            </Button>
            {own.status !== 'active' && (
              <a href="/api/calendar/google/connect">
                <Button variant="primary" size="sm">
                  {t('reconnect')}
                </Button>
              </a>
            )}
          </div>
        </div>
      ) : (
        <a href="/api/calendar/google/connect">
          <Button variant="primary" size="sm">
            {t('connect')}
          </Button>
        </a>
      )}

      {orgConnections.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-medium uppercase text-slate-500">Org</p>
          <ul className="space-y-1.5">
            {orgConnections.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm text-slate-700">
                <span>{c.profileName ?? c.googleEmail}</span>
                <Badge variant={statusVariant(c.status)}>
                  {c.status === 'active' ? t('connected') : c.status === 'revoked' ? t('statusRevoked') : t('statusError')}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
