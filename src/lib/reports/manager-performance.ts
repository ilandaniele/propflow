import { roundedAverage } from './average';

export const PERIOD_DAYS = [30, 90, 365] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

export function parsePeriodDays(value: string | undefined): PeriodDays {
  return PERIOD_DAYS.find((days) => String(days) === value) ?? PERIOD_DAYS[0];
}

export type ManagerPerformanceRow = {
  profileId: string;
  name: string;
  assigned: number;
  resolved: number;
  timedResolved: number;
  resolutionDaysSum: number;
};

export type ManagerStats = {
  assigned: number;
  resolved: number;
  open: number;
  avgResolutionDays: number | null;
};

export type ManagerPerformance = ManagerStats & { profileId: string; name: string };

export type ManagerPerformanceReport = { managers: ManagerPerformance[]; totals: ManagerStats };

function toStats(row: Omit<ManagerPerformanceRow, 'profileId' | 'name'>): ManagerStats {
  return {
    assigned: row.assigned,
    resolved: row.resolved,
    open: row.assigned - row.resolved,
    avgResolutionDays: roundedAverage(row.resolutionDaysSum, row.timedResolved, 1),
  };
}

export function summarizeManagerPerformance(rows: ManagerPerformanceRow[]): ManagerPerformanceReport {
  const managers = rows
    .map((row) => ({ profileId: row.profileId, name: row.name, ...toStats(row) }))
    .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  const sum = (pick: (row: ManagerPerformanceRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const totals = toStats({
    assigned: sum((row) => row.assigned),
    resolved: sum((row) => row.resolved),
    timedResolved: sum((row) => row.timedResolved),
    resolutionDaysSum: sum((row) => row.resolutionDaysSum),
  });

  return { managers, totals };
}
