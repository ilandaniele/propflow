/**
 * normalizeTaxReceipt — server-only.
 *
 * Maps a raw Airtable record from the "Impuestos / Comprobantes" table
 * to a row ready to upsert into public.tax_receipts.
 *
 * Fields: Comprobante ID, Tipo, Número de comprobante, Mes, Año,
 *         Fecha de emisión, Monto base (S/), Incluye IGV, IGV 18% (S/),
 *         Monto total (S/), Archivo, Estado, 📋 Historial (Contratos),
 *         IGV calculado (S/), Monto total calculado (S/)
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';

export const TAX_RECEIPT_FIELD = {
  RECEIPT_CODE:   'Comprobante ID',
  TIPO:           'Tipo',
  NUMERO:         'Número de comprobante',
  MES:            'Mes',
  AÑO:            'Año',
  ISSUE_DATE:     'Fecha de emisión',
  BASE_AMOUNT:    'Monto base (S/)',
  INCLUDES_IGV:   'Incluye IGV',
  IGV_AMOUNT:     'IGV 18% (S/)',
  TOTAL_AMOUNT:   'Monto total (S/)',
  FILE:           'Archivo',
  STATUS:         'Estado',
  CONTRACT_LINK:  'Historial (Contratos)',
} as const;

export interface NormalizedTaxReceipt {
  airtableExternalId: string;
  receiptCode:        string | null;
  tipo:               string | null;
  numero:             string | null;
  mes:                string | null;
  anio:               number | null;
  issueDate:          string | null;
  baseAmount:         number | null;
  includesIgv:        boolean;
  igvAmount:          number | null;
  totalAmount:        number | null;
  status:             string | null;
  fileUrl:            string | null;
  contractAirtableId: string | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function extractFileUrl(v: unknown): string | null {
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0] as Record<string, unknown>;
    return typeof first.url === 'string' ? first.url : null;
  }
  return null;
}

export function normalizeTaxReceipt(record: AirtableRecord): NormalizedTaxReceipt | null {
  const f = record.fields;

  return {
    airtableExternalId: record.id,
    receiptCode:        toStr(f[TAX_RECEIPT_FIELD.RECEIPT_CODE]),
    tipo:               toStr(f[TAX_RECEIPT_FIELD.TIPO]),
    numero:             toStr(f[TAX_RECEIPT_FIELD.NUMERO]),
    mes:                toStr(f[TAX_RECEIPT_FIELD.MES]),
    anio:               toNum(f[TAX_RECEIPT_FIELD.AÑO]),
    issueDate:          toStr(f[TAX_RECEIPT_FIELD.ISSUE_DATE]),
    baseAmount:         toNum(f[TAX_RECEIPT_FIELD.BASE_AMOUNT]),
    includesIgv:        f[TAX_RECEIPT_FIELD.INCLUDES_IGV] === true,
    igvAmount:          toNum(f[TAX_RECEIPT_FIELD.IGV_AMOUNT]),
    totalAmount:        toNum(f[TAX_RECEIPT_FIELD.TOTAL_AMOUNT]),
    status:             toStr(f[TAX_RECEIPT_FIELD.STATUS]),
    fileUrl:            extractFileUrl(f[TAX_RECEIPT_FIELD.FILE]),
    contractAirtableId: extractFirstLinkedId(f[TAX_RECEIPT_FIELD.CONTRACT_LINK]),
  };
}
