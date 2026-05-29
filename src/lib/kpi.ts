export interface DashboardKPIs {
  occupancyRate: number; // 0-100 percentage
  totalUnits: number;
  occupiedUnits: number;
  rentCollectedThisMonth: number;
  openIncidents: number;
  overdueTenantsCount: number;
}

export function computeOccupancyRate(occupiedUnits: number, totalUnits: number): number {
  if (totalUnits === 0) return 0;
  return Math.round((occupiedUnits / totalUnits) * 100);
}

export function isCurrentMonth(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function computeRentCollectedThisMonth(
  approvedPayments: Array<{ amount: number; paid_at: string }>
): number {
  return approvedPayments
    .filter((p) => isCurrentMonth(p.paid_at))
    .reduce((sum, p) => sum + p.amount, 0);
}
