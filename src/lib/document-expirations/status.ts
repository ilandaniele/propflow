export const ALERT_WINDOW_DAYS = 30;

export type ExpiryStatus = 'expired' | 'soon' | 'ok';

const DAY_MS = 86_400_000;

export function limaToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function expiryStatus(expiresOn: string, today: string): ExpiryStatus {
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addDays(today, ALERT_WINDOW_DAYS)) return 'soon';
  return 'ok';
}
