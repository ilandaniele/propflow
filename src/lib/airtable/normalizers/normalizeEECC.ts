/**
 * normalizeEECC — server-only.
 *
 * Maps a raw Airtable record from the EECC table (Estado de Cuenta /
 * Account Statement) to a row ready to upsert into public.account_statements.
 *
 * Fields: EECC ID, Contrato, Mes, Año, Fecha de emisión, Fecha de vencimiento,
 *         PDF, Monto renta (S/), Subtotal adicionales (S/),
 *         Saldo anterior renta (S/), Saldo anterior adicional (S/),
 *         Estado envío, Fecha de envío, Total a pagar (S/),
 *         WhatsApp Message ID, Error envío
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';

export const EECC_FIELD = {
  EECC_ID:             'EECC ID',
  CONTRACT_LINK:       'Contrato',
  MES:                 'Mes',
  AÑO:                 'Año',
  ISSUE_DATE:          'Fecha de emisión',
  DUE_DATE:            'Fecha de vencimiento',
  PDF:                 'PDF',
  RENT_AMOUNT:         'Monto renta (S/)',
  ADDL_SUBTOTAL:       'Subtotal adicionales (S/)',
  PREV_RENT_BALANCE:   'Saldo anterior renta (S/)',
  PREV_ADDL_BALANCE:   'Saldo anterior adicional (S/)',
  SEND_STATUS:         'Estado envío',
  SEND_DATE:           'Fecha de envío',
  TOTAL_DUE:           'Total a pagar (S/)',
  WA_MSG_ID:           'WhatsApp Message ID',
  SEND_ERROR:          'Error envío',
} as const;

export interface NormalizedEECC {
  airtableExternalId:   string;
  eeccCode:             string | null;
  contractAirtableId:   string | null;
  mes:                  string | null;
  anio:                 number | null;
  issueDate:            string | null;
  dueDate:              string | null;
  pdfUrl:               string | null;
  rentAmount:           number | null;
  additionalSubtotal:   number | null;
  previousRentBalance:  number | null;
  previousAddlBalance:  number | null;
  totalDue:             number | null;
  sendStatus:           string | null;
  sendDate:             string | null;
  whatsappMessageId:    string | null;
  sendError:            string | null;
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

function extractPdfUrl(v: unknown): string | null {
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0] as Record<string, unknown>;
    return typeof first.url === 'string' ? first.url : null;
  }
  return null;
}

export function normalizeEECC(record: AirtableRecord): NormalizedEECC | null {
  const f = record.fields;

  return {
    airtableExternalId:   record.id,
    eeccCode:             toStr(f[EECC_FIELD.EECC_ID]),
    contractAirtableId:   extractFirstLinkedId(f[EECC_FIELD.CONTRACT_LINK]),
    mes:                  toStr(f[EECC_FIELD.MES]),
    anio:                 toNum(f[EECC_FIELD.AÑO]),
    issueDate:            toStr(f[EECC_FIELD.ISSUE_DATE]),
    dueDate:              toStr(f[EECC_FIELD.DUE_DATE]),
    pdfUrl:               extractPdfUrl(f[EECC_FIELD.PDF]),
    rentAmount:           toNum(f[EECC_FIELD.RENT_AMOUNT]),
    additionalSubtotal:   toNum(f[EECC_FIELD.ADDL_SUBTOTAL]),
    previousRentBalance:  toNum(f[EECC_FIELD.PREV_RENT_BALANCE]),
    previousAddlBalance:  toNum(f[EECC_FIELD.PREV_ADDL_BALANCE]),
    totalDue:             toNum(f[EECC_FIELD.TOTAL_DUE]),
    sendStatus:           toStr(f[EECC_FIELD.SEND_STATUS]),
    sendDate:             toStr(f[EECC_FIELD.SEND_DATE]),
    whatsappMessageId:    toStr(f[EECC_FIELD.WA_MSG_ID]),
    sendError:            toStr(f[EECC_FIELD.SEND_ERROR]),
  };
}
