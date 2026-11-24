export const DOC_TYPES = ['boleta', 'factura'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const CUSTOMER_DOC_TYPES = ['dni', 'ruc', 'none'] as const;
export type CustomerDocType = (typeof CUSTOMER_DOC_TYPES)[number];

export const DEFAULT_SERIES: Record<DocType, string> = { boleta: 'B001', factura: 'F001' };
export const IGV_RATE = 0.18;
export const ANONYMOUS_BOLETA_LIMIT = 700;

export interface Amounts {
  total: string;
  base: string;
  igv: string;
}

export function splitIgv(total: number | string): Amounts {
  const totalCents = Math.round(Number(total) * 100);
  const baseCents = Math.round(totalCents / (1 + IGV_RATE));
  const toMoney = (cents: number) => (cents / 100).toFixed(2);
  return { total: toMoney(totalCents), base: toMoney(baseCents), igv: toMoney(totalCents - baseCents) };
}

const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function isValidRuc(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;
  const sum = RUC_WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(ruc[i]), 0);
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(ruc[10]);
}

export type CustomerDocError = 'ruc_required' | 'invalid_ruc' | 'dni_or_none_required' | 'invalid_dni' | 'document_required';

export function validateCustomerDoc(
  docType: DocType,
  customerDocType: CustomerDocType,
  customerDocNumber: string,
  total: number,
): CustomerDocError | null {
  if (docType === 'factura') {
    if (customerDocType !== 'ruc') return 'ruc_required';
    return isValidRuc(customerDocNumber) ? null : 'invalid_ruc';
  }
  if (customerDocType === 'dni') return /^\d{8}$/.test(customerDocNumber) ? null : 'invalid_dni';
  if (customerDocType === 'ruc') return 'dni_or_none_required';
  return total < ANONYMOUS_BOLETA_LIMIT ? null : 'document_required';
}
