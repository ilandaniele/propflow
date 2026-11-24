export function formatAmount(amount: string, currency: string): string {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(Number(amount));
}

export function isIntentPayable(intent: { status: string; expiresAt: Date }, now = new Date()): boolean {
  return intent.status === 'pending' && intent.expiresAt > now;
}
