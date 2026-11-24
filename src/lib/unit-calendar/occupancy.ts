import type { CalendarEvent } from './ical';

export const OPEN_ENDED_DAYS = 365;

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Contract stays as blocked ranges. Contract end dates are inclusive; iCal DTEND is exclusive. Open-ended contracts block a year ahead. */
export function contractsToEvents(
  contracts: { id: string; startDate: string; endDate: string | null }[],
  today: string,
): CalendarEvent[] {
  return contracts.map((c) => ({
    uid: `contract-${c.id}@propflow`,
    startsOn: c.startDate,
    endsOn: addDays(c.endDate ?? addDays(today, OPEN_ENDED_DAYS), 1),
    summary: 'Not available',
  }));
}
