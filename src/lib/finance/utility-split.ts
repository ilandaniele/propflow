export const SPLIT_METHODS = ['equal', 'area', 'days'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export interface SplitOccupant {
  contractId: string;
  tenantId: string;
  areaM2: number | null;
  startDate: string;
  endDate: string | null;
}

export interface SplitShare {
  contractId: string;
  tenantId: string;
  amount: number;
}

export interface SplitInput {
  amount: number;
  tope: number | null;
  month: string;
  method: SplitMethod;
  occupants: SplitOccupant[];
}

const DAY_MS = 86_400_000;

export function chargeableAmount(amount: number, tope: number | null): number {
  return tope === null ? amount : Math.max(0, amount - tope);
}

export function monthBounds(month: string): { first: string; last: string; days: number } {
  const [year, monthIndex] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days };
}

export function occupiedDays(occupant: SplitOccupant, month: string): number {
  const { first, last } = monthBounds(month);
  const from = occupant.startDate > first ? occupant.startDate : first;
  const to = occupant.endDate !== null && occupant.endDate < last ? occupant.endDate : last;
  if (from > to) return 0;
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

function weightOf(occupant: SplitOccupant, method: SplitMethod, month: string): number {
  if (method === 'area') return occupant.areaM2 ?? 0;
  if (method === 'days') return occupiedDays(occupant, month);
  return 1;
}

function allocateCents(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const cents = exact.map(Math.floor);
  let remainder = totalCents - cents.reduce((sum, c) => sum + c, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of byFraction) {
    if (remainder === 0) break;
    cents[index] += 1;
    remainder -= 1;
  }
  return cents;
}

export function splitUtility({ amount, tope, month, method, occupants }: SplitInput): SplitShare[] {
  const totalCents = Math.round(chargeableAmount(amount, tope) * 100);
  const present = occupants.filter((o) => occupiedDays(o, month) > 0);
  const weights = present.map((o) => weightOf(o, method, month));
  if (totalCents === 0 || weights.every((w) => w <= 0)) return [];

  return allocateCents(totalCents, weights)
    .map((cents, index) => ({ contractId: present[index].contractId, tenantId: present[index].tenantId, amount: cents / 100 }))
    .filter((share) => share.amount > 0);
}
