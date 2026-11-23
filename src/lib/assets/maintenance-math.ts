export type DueStatus = 'overdue' | 'soon' | 'ok';

const SOON_DAYS = 30;
const DAY_MS = 86_400_000;

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function nextDue(startsOn: string, frequencyMonths: number, lastDoneOn: string | null): string {
  return lastDoneOn ? addMonths(lastDoneOn, frequencyMonths) : startsOn;
}

export function dueStatus(due: string, today: string): DueStatus {
  if (due < today) return 'overdue';
  const days = (Date.parse(due) - Date.parse(today)) / DAY_MS;
  return days <= SOON_DAYS ? 'soon' : 'ok';
}

export function plannedMonths(startsOn: string, frequencyMonths: number, year: number): number[] {
  const [startYear, startMonth] = startsOn.split('-').map(Number);
  const startIndex = startYear * 12 + startMonth - 1;
  const months: number[] = [];
  for (let month = 0; month < 12; month++) {
    const offset = year * 12 + month - startIndex;
    if (offset >= 0 && offset % frequencyMonths === 0) months.push(month);
  }
  return months;
}

export function doneMonths(doneDates: string[], year: number): number[] {
  const prefix = `${year}-`;
  const months = new Set(doneDates.filter((date) => date.startsWith(prefix)).map((date) => Number(date.slice(5, 7)) - 1));
  return [...months].sort((a, b) => a - b);
}

export function annualCost(estimatedCost: string | null, plannedCount: number): number {
  return estimatedCost ? Number(estimatedCost) * plannedCount : 0;
}

export function taskSchedule(
  task: { startsOn: string; frequencyMonths: number; lastDoneOn: string | null },
  today: string,
): { due: string; status: DueStatus } {
  const due = nextDue(task.startsOn, task.frequencyMonths, task.lastDoneOn);
  return { due, status: dueStatus(due, today) };
}
