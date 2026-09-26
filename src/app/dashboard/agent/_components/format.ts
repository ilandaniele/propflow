/** Small, dependency-free formatters shared by the metrics dashboard and calls log (Phase 8-9, item E). */

export function formatPercent(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatSeconds(sec: number | null): string {
  if (sec === null) return '—';
  const rounded = Math.round(sec);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}m ${seconds}s`;
}

/** "+51987654321" -> "+51•••••321". Short/empty phones are fully masked. */
export function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  if (phone.length <= 6) return '•'.repeat(phone.length);
  return `${phone.slice(0, 3)}•••••${phone.slice(-3)}`;
}
