export type OwnerCommand =
  | { kind: 'link'; code: string }
  | { kind: 'expense'; amount: number; description: string }
  | { kind: 'payment'; amount: number; tenantQuery: string }
  | { kind: 'help' }
  | { kind: 'unknown' };

const EXPENSE_WORDS = new Set(['gasto', 'gaste', 'gastos', 'expense', 'despesa', 'gastei']);
const PAYMENT_WORDS = new Set(['pago', 'pagos', 'cobro', 'cobre', 'payment', 'pagamento', 'recebi']);
const HELP_WORDS = new Set(['ayuda', 'help', 'ajuda', '?', 'menu']);
const FILLER_WORDS = new Set(['en', 'de', 'por', 'del', 'para', 'soles', 'pen', 's/', 's/.', 'of', 'for', 'on', 'from', 'em', 'do', 'da']);

function fold(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Parses "120", "120.50", "120,50", "1.200", "1,200.50", "S/120". Null when not a positive amount. */
export function parseAmount(token: string): number | null {
  const raw = token.replace(/^s\/\.?/i, '');
  if (!/^\d[\d.,]*$/.test(raw)) return null;
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let normalized = raw;
  if (lastSep !== -1) {
    const decimals = raw.length - lastSep - 1;
    const intPart = raw.slice(0, lastSep).replace(/[.,]/g, '');
    normalized = decimals > 0 && decimals <= 2 ? `${intPart}.${raw.slice(lastSep + 1)}` : raw.replace(/[.,]/g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function splitAmount(words: string[]): { amount: number | null; rest: string } {
  const index = words.findIndex((w) => parseAmount(w) !== null);
  if (index === -1) return { amount: null, rest: '' };
  const restWords = words.filter((_, i) => i !== index);
  while (restWords.length && FILLER_WORDS.has(fold(restWords[0]))) restWords.shift();
  return { amount: parseAmount(words[index]), rest: restWords.join(' ').trim() };
}

export function parseOwnerCommand(text: string | null): OwnerCommand {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { kind: 'unknown' };
  const head = fold(words[0]);

  if (head === 'vincular' || head === 'link' || head === 'vincular:') {
    const code = words[1]?.replace(/\D/g, '') ?? '';
    return /^\d{6}$/.test(code) ? { kind: 'link', code } : { kind: 'unknown' };
  }
  if (HELP_WORDS.has(head) && words.length === 1) return { kind: 'help' };

  const { amount, rest } = splitAmount(words.slice(1));
  if (amount === null) return { kind: 'unknown' };
  if (EXPENSE_WORDS.has(head)) return { kind: 'expense', amount, description: rest.slice(0, 200) };
  if (PAYMENT_WORDS.has(head) && rest.length >= 2) return { kind: 'payment', amount, tenantQuery: rest.slice(0, 80) };
  return { kind: 'unknown' };
}
