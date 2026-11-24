export const CURRENCIES = ['PEN', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: Currency = 'PEN';

const SYMBOLS: Record<string, string> = { PEN: 'S/', USD: 'US$', EUR: '€' };

export function formatMoney(currency: string, amount: number): string {
  const symbol = SYMBOLS[currency] ?? currency;
  return `${symbol} ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function groupByCurrency<T extends { currency?: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.currency ?? BASE_CURRENCY;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export function currenciesInUse(...groups: Map<string, unknown>[]): string[] {
  const all = new Set(groups.flatMap((g) => [...g.keys()]));
  return [...all].sort((a, b) => (a === BASE_CURRENCY ? -1 : b === BASE_CURRENCY ? 1 : a.localeCompare(b)));
}
