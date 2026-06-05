/**
 * Airtable entity Zod schemas — server-only.
 *
 * Each schema describes the normalised (post-normalizer) shape that is written
 * into the corresponding main domain table. All entity-level fields are optional
 * unless otherwise noted, because Airtable rows may have empty cells.
 *
 * Wire-level schemas (AirtableRecordSchema) live in src/lib/schemas/airtable.ts.
 * These schemas describe the OUTPUT of each normalizer, not the Airtable wire format.
 *
 * NEVER import in 'use client' components.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Coerce a string date (YYYY-MM-DD) or null/undefined → Date | null */
const NullableDateString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/** Coerce a numeric string or number → number | null */
const NullableNumeric = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(v as string);
    return isNaN(n) ? null : n;
  });

/** Extract first element from a linked-record array (Airtable returns string[]) */
export function extractFirstLinkedId(value: unknown): string | null {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Propiedades (→ properties)
// ---------------------------------------------------------------------------

export const NormalizedPropertySchema = z.object({
  org_id:                z.string().uuid(),
  airtable_external_id:  z.string().min(1),
  airtable_synced_at:    z.string().datetime(),
  name:                  z.string().min(1),
  address:               z.string().nullable().optional(),
  city:                  z.string().nullable().optional(),
  country:               z.string().nullable().optional(),
  district:              z.string().nullable().optional(),
  modality:              z.string().nullable().optional(),
  supply_number_luz:     z.string().nullable().optional(),
  total_rooms:           z.number().int().nullable().optional(),
  current_residents:     z.number().int().nullable().optional(),
  description:           z.string().nullable().optional(),
});

export type NormalizedProperty = z.infer<typeof NormalizedPropertySchema>;

// ---------------------------------------------------------------------------
// Residentes (→ tenants)
// ---------------------------------------------------------------------------

export const NormalizedTenantSchema = z.object({
  org_id:                z.string().uuid(),
  airtable_external_id:  z.string().min(1),
  airtable_synced_at:    z.string().datetime(),
  full_name:             z.string().min(1),
  first_name:            z.string().nullable().optional(),
  last_name:             z.string().nullable().optional(),
  email:                 z.string().nullable().optional(),
  phone:                 z.string().nullable().optional(),
  codigo:                z.string().nullable().optional(),
  dni:                   z.string().nullable().optional(),
  birth_date:            NullableDateString,
  payment_due_day:       z.number().int().nullable().optional(),
  monthly_rent:          NullableNumeric,
  deposit:               NullableNumeric,
  tenant_status:         z.string().nullable().optional(),
  contract_start:        NullableDateString,
  contract_end:          NullableDateString,
  duration_months:       z.number().int().nullable().optional(),
  // Resolved link fields — populated by link resolver after normalisation
  property_id:           z.string().uuid().nullable().optional(),
  unit_id:               z.string().uuid().nullable().optional(),
  // Raw linked-record id — used by link resolver, not written to DB
  _airtable_property_ext_id: z.string().nullable().optional(),
  _airtable_unit_label:      z.string().nullable().optional(),
});

export type NormalizedTenant = z.infer<typeof NormalizedTenantSchema>;

// ---------------------------------------------------------------------------
// Historial (→ contracts)
// ---------------------------------------------------------------------------

export const NormalizedContractSchema = z.object({
  org_id:                z.string().uuid(),
  airtable_external_id:  z.string().min(1),
  airtable_synced_at:    z.string().datetime(),
  start_date:            z.string().nullable().optional(),  // DATE string
  end_date:              z.string().nullable().optional(),  // DATE string
  monthly_rent:          NullableNumeric,
  status:                z.string().nullable().optional(),
  deposit:               NullableNumeric,
  contract_code:         z.string().nullable().optional(),
  contract_type:         z.string().nullable().optional(),
  duration_months:       z.number().int().nullable().optional(),
  deposit_receipt_url:   z.string().nullable().optional(),
  // Resolved link fields
  tenant_id:             z.string().uuid().nullable().optional(),
  unit_id:               z.string().uuid().nullable().optional(),
  // Raw linked ids for resolver
  _airtable_tenant_ext_id: z.string().nullable().optional(),
  _airtable_unit_ext_id:   z.string().nullable().optional(),
});

export type NormalizedContract = z.infer<typeof NormalizedContractSchema>;

// ---------------------------------------------------------------------------
// Pagos (→ payments)
// ---------------------------------------------------------------------------

export const NormalizedPaymentSchema = z.object({
  org_id:                z.string().uuid(),
  airtable_external_id:  z.string().min(1),
  airtable_synced_at:    z.string().datetime(),
  amount:                NullableNumeric,
  paid_at:               NullableDateString,
  method:                z.string().nullable().optional(),
  status:                z.string().nullable().optional(),
  name:                  z.string().nullable().optional(),
  period_month:          z.string().nullable().optional(),
  due_date:              NullableDateString,
  phone:                 z.string().nullable().optional(),
  tenant_name:           z.string().nullable().optional(),
  // Resolved link fields
  contract_id:           z.string().uuid().nullable().optional(),
  tenant_id:             z.string().uuid().nullable().optional(),
  // Raw linked ids for resolver
  _airtable_contract_ext_id: z.string().nullable().optional(),
  _airtable_tenant_ext_id:   z.string().nullable().optional(),
});

export type NormalizedPayment = z.infer<typeof NormalizedPaymentSchema>;
