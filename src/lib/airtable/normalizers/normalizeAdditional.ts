/**
 * normalizeAdditional — server-only.
 *
 * Maps a raw Airtable record from the Adicionales table to a row
 * ready to upsert into public.additional_charges.
 *
 * Fields: Adicional ID (auto), Contrato, Concepto, Mes, Año, Monto (S/),
 *         Descripción / detalle, 💰 Movimientos 2, #, Propiedad
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';

export const ADDITIONAL_FIELD = {
  ADICIONAL_ID:  'Adicional ID (auto)',
  CONTRACT_LINK: 'Contrato',
  CONCEPT_LINK:  'Concepto',
  MES:           'Mes',
  AÑO:           'Año',
  AMOUNT:        'Monto (S/)',
  DESCRIPTION:   'Descripción / detalle',
  NUMERO:        '#',
} as const;

export interface NormalizedAdditional {
  airtableExternalId: string;
  contractAirtableId: string | null;
  conceptAirtableId:  string | null;
  mes:                string | null;
  anio:               number | null;
  amount:             number;
  description:        string | null;
  numero:             number | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Returns null when amount is missing/zero (record has no billable charge).
 */
export function normalizeAdditional(
  record: AirtableRecord,
): NormalizedAdditional | null {
  const f = record.fields;

  const amount = toNum(f[ADDITIONAL_FIELD.AMOUNT]);
  if (amount === null || amount <= 0) return null;

  return {
    airtableExternalId: record.id,
    contractAirtableId: extractFirstLinkedId(f[ADDITIONAL_FIELD.CONTRACT_LINK]),
    conceptAirtableId:  extractFirstLinkedId(f[ADDITIONAL_FIELD.CONCEPT_LINK]),
    mes:                typeof f[ADDITIONAL_FIELD.MES] === 'string' ? (f[ADDITIONAL_FIELD.MES] as string) : null,
    anio:               toNum(f[ADDITIONAL_FIELD.AÑO]),
    amount,
    description:        typeof f[ADDITIONAL_FIELD.DESCRIPTION] === 'string' ? (f[ADDITIONAL_FIELD.DESCRIPTION] as string) : null,
    numero:             toNum(f[ADDITIONAL_FIELD.NUMERO]),
  };
}
