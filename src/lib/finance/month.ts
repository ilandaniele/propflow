export const formatAmount = (currency: string, value: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value);

export function shiftMonth(month: string, delta: number) {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
