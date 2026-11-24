export interface YieldInput {
  price: number;
  monthlyRent: number;
  monthlyExpenses: number;
  vacancyMonths: number;
}

export interface YieldResult {
  annualIncome: number;
  annualNet: number;
  grossYield: number;
  netYield: number;
  paybackYears: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function rentalYield({ price, monthlyRent, monthlyExpenses, vacancyMonths }: YieldInput): YieldResult {
  const occupiedMonths = Math.max(0, 12 - vacancyMonths);
  const annualIncome = monthlyRent * occupiedMonths;
  const annualNet = annualIncome - monthlyExpenses * 12;
  const ratio = (value: number) => (price > 0 ? round2((value / price) * 100) : 0);
  return {
    annualIncome: round2(annualIncome),
    annualNet: round2(annualNet),
    grossYield: ratio(monthlyRent * 12),
    netYield: ratio(annualNet),
    paybackYears: annualNet > 0 && price > 0 ? round2(price / annualNet) : null,
  };
}

export function rentAdjustment(currentRent: number, percent: number) {
  const newRent = round2(currentRent * (1 + percent / 100));
  return { newRent, difference: round2(newRent - currentRent) };
}

export interface SplitUnit {
  label: string;
  area: number;
}

export function splitExpense(total: number, units: SplitUnit[], byArea: boolean) {
  const count = units.length;
  if (count === 0) return [];
  const totalArea = units.reduce((sum, unit) => sum + unit.area, 0);
  const weight = (unit: SplitUnit) => (byArea && totalArea > 0 ? unit.area / totalArea : 1 / count);
  const shares = units.map((unit) => ({ label: unit.label, amount: round2(total * weight(unit)) }));
  const drift = round2(total - shares.reduce((sum, share) => sum + share.amount, 0));
  shares[count - 1].amount = round2(shares[count - 1].amount + drift);
  return shares;
}
