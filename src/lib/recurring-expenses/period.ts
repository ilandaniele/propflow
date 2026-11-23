const LIMA = 'America/Lima';

export function currentPeriod(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: LIMA }).slice(0, 7);
}

