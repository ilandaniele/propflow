import { log } from '@/lib/log';
import { parseIcalEvents } from './ical';
import { fetchRemoteCalendar } from './remote';
import { listDueCalendars, recordSyncError, replaceExternalBlocks, type UnitCalendar } from './queries';

const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SYNCS_PER_SWEEP = 5;

/** Pulls the calendar's import URL into its external blocks. Failures are stored on the calendar, never thrown. */
export async function syncUnitCalendar(calendar: UnitCalendar): Promise<boolean> {
  const now = new Date();
  if (!calendar.importUrl) return false;
  try {
    const events = parseIcalEvents(await fetchRemoteCalendar(calendar.importUrl));
    await replaceExternalBlocks(calendar, events, now);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Calendar sync failed';
    log.warn('[unit-calendar] sync failed', { calendarId: calendar.id, error: message });
    await recordSyncError(calendar.id, message, now);
    return false;
  }
}

/** Sweep step: re-syncs up to 5 calendars not synced in the last hour. Returns how many synced. */
export async function syncDueUnitCalendars(): Promise<number> {
  const due = await listDueCalendars(new Date(Date.now() - SYNC_INTERVAL_MS), SYNCS_PER_SWEEP);
  let synced = 0;
  for (const calendar of due) {
    if (await syncUnitCalendar(calendar)) synced++;
  }
  return synced;
}
