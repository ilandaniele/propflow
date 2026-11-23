export const AGING_BUCKETS = ['0_30', '31_60', '61_90', '90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingCharge {
  tenantId: string;
  amount: number;
  dueDate: string;
}

export interface TenantAging {
  tenantId: string;
  buckets: Record<AgingBucket, number>;
  total: number;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function bucketFor(daysLate: number): AgingBucket {
  if (daysLate <= 30) return '0_30';
  if (daysLate <= 60) return '31_60';
  if (daysLate <= 90) return '61_90';
  return '90_plus';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyBuckets(): Record<AgingBucket, number> {
  return { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
}

function groupByTenant(charges: AgingCharge[]): Map<string, AgingCharge[]> {
  const byTenant = new Map<string, AgingCharge[]>();
  for (const charge of charges) {
    const list = byTenant.get(charge.tenantId) ?? [];
    list.push(charge);
    byTenant.set(charge.tenantId, list);
  }
  return byTenant;
}

function agingForTenant(tenantId: string, charges: AgingCharge[], paid: number, today: string): TenantAging {
  const buckets = emptyBuckets();
  let credit = paid;
  for (const charge of [...charges].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const covered = Math.min(credit, charge.amount);
    credit -= covered;
    const unpaid = charge.amount - covered;
    const daysLate = daysBetween(charge.dueDate, today);
    if (unpaid > 0 && daysLate > 0) buckets[bucketFor(daysLate)] += unpaid;
  }
  for (const bucket of AGING_BUCKETS) buckets[bucket] = round2(buckets[bucket]);
  const total = round2(AGING_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0));
  return { tenantId, buckets, total };
}

export function computeAging(charges: AgingCharge[], paidByTenant: Map<string, number>, today: string): TenantAging[] {
  return [...groupByTenant(charges)]
    .map(([tenantId, list]) => agingForTenant(tenantId, list, paidByTenant.get(tenantId) ?? 0, today))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);
}
