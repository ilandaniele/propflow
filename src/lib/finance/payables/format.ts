export function formatSolesCents(cents: number): string {
  return `S/ ${(cents / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
