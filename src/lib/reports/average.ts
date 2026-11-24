export function roundedAverage(sum: number, count: number, decimals: number): number | null {
  if (count === 0) return null;
  const factor = 10 ** decimals;
  return Math.round((sum / count) * factor) / factor;
}
