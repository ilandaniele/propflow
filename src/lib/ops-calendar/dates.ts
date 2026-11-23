export const CALENDAR_TIMEZONE = 'America/Lima';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(raw: string | undefined, today: string): string {
  return raw && MONTH.test(raw) ? raw : today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

export function addDaysUtc(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayInZone(ms: number, timeZone = CALENDAR_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
