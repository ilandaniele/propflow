export function adjustedRent(rent: number, percent: number): number {
  return Math.round(rent * (1 + percent / 100) * 100) / 100;
}

function onYear(isoDate: string, year: number): string {
  const monthDay = isoDate.slice(5);
  const isLeapYear = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return `${year}-${monthDay === '02-29' && !isLeapYear ? '02-28' : monthDay}`;
}

export function nextAnniversary(startDate: string, today: string): string {
  const year = Math.max(Number(today.slice(0, 4)), Number(startDate.slice(0, 4)) + 1);
  const candidate = onYear(startDate, year);
  return candidate >= today ? candidate : onYear(startDate, year + 1);
}

export function isAdjustmentDue(anniversary: string, lastAdjustedOn: string | null, horizon: string): boolean {
  if (anniversary > horizon) return false;
  const previousAnniversary = onYear(anniversary, Number(anniversary.slice(0, 4)) - 1);
  return !lastAdjustedOn || lastAdjustedOn <= previousAnniversary;
}

export function isoDaysFrom(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
