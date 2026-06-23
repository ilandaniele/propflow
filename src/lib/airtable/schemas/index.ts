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
  // current_residents and description removed from new base schema but kept optional for backward compat
  current_residents:     z.number().int().nullable().optional(),
  description:           z.string().nullable().optional(),
  // codigo_pago_internet removed from new schema (internet supply gone from Propiedades)
  codigo_pago_internet:  z.string().nullable().optional(),
  n_cliente_gas:         z.string().nullable().optional(),
  n_suministro_agua:     z.string().nullable().optional(),
  // New fields in the new base schema
  tope_luz:              z.number().nullable().optional(),
  tope_agua:             z.number().nullable().optional(),
  folder_id:             z.string().nullable().optional(),
  gas_type:              z.string().nullable().optional(),
  n_pe:                  z.string().nullable().optional(),
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
  // Contract-related fields — OPTIONAL in new base schema (moved to Historial/Contratos).
  // These fields may not be present in Residentes records; absent = undefined = DB not overwritten.
  payment_due_day:       z.number().int().nullable().optional(),
  monthly_rent:          z.number().nullable().optional(),
  deposit:               z.number().nullable().optional(),
  tenant_status:         z.string().nullable().optional(),
  contract_start:        z.string().nullable().optional(),
  contract_end:          z.string().nullable().optional(),
  duration_months:       z.number().int().nullable().optional(),
  // Resolved link fields — populated by link resolver after normalisation
  property_id:           z.string().uuid().nullable().optional(),
  unit_id:               z.string().uuid().nullable().optional(),
  // Profile photo URL — mapped from Airtable "Foto de perfil" attachment field
  // Only present if the field exists in Airtable; never clobbers existing photo_url with null
  photo_url:             z.string().nullable().optional(),
  occupation:            z.string().nullable().optional(),
  foto_tiu_url:          z.string().nullable().optional(),
  solvency_doc_url:      z.string().nullable().optional(),
  acquisition_channels:  z.string().nullable().optional(),
  exit_reason:           z.string().nullable().optional(),
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
  status:                z.enum(['active', 'expired', 'terminated']),  // mapContractStatus always returns one of these
  deposit:               NullableNumeric,
  contract_code:         z.string().nullable().optional(),
  contract_type:         z.string().nullable().optional(),
  duration_months:       z.number().int().nullable().optional(),
  deposit_receipt_url:   z.string().nullable().optional(),
  actual_exit_date:      z.string().nullable().optional(),
  signed_contract_url:   z.string().nullable().optional(),
  exit_reason:           z.string().nullable().optional(),
  penalty_applied:       z.boolean().nullable().optional(),
  penalty_amount:        NullableNumeric,
  deposit_returned:      NullableNumeric,
  exit_debt:             NullableNumeric,
  payment_status:        z.string().nullable().optional(),
  cleaning_fee_status:   z.string().nullable().optional(),
  has_glp:               z.boolean().nullable().optional(),
  actual_close_date:     z.string().nullable().optional(),
  keynua_contract_id:    z.string().nullable().optional(),
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
  receipt_url:           z.string().nullable().optional(),
  previous_balance_applied:      NullableNumeric,
  previous_addl_balance_applied: NullableNumeric,
  days_overdue:                  z.number().int().nullable().optional(),
  concept:                       z.string().nullable().optional(),
  // Resolved link fields
  contract_id:           z.string().uuid().nullable().optional(),
  tenant_id:             z.string().uuid().nullable().optional(),
  // Raw linked ids for resolver
  _airtable_contract_ext_id: z.string().nullable().optional(),
  _airtable_tenant_ext_id:   z.string().nullable().optional(),
});

export type NormalizedPayment = z.infer<typeof NormalizedPaymentSchema>;

// ---------------------------------------------------------------------------
// Portafolio (→ units)
// ---------------------------------------------------------------------------

export const NormalizedUnitSchema = z.object({
  org_id:                z.string(),
  airtable_external_id:  z.string(),
  airtable_synced_at:    z.string().nullable().optional(),
  label:                 z.string().nullable(),
  toilet_type:           z.enum(['private', 'shared']).nullable(),
  area_m2:               z.number().nullable(),
  status:                z.enum(['available', 'occupied', 'maintenance']).nullable(),
  _airtable_property_ext_id: z.string().nullable(),
});

export type NormalizedUnitSchemaType = z.infer<typeof NormalizedUnitSchema>;

// ---------------------------------------------------------------------------
// Responsables (→ responsables)
// ---------------------------------------------------------------------------

export const NormalizedResponsableSchema = z.object({
  org_id:                z.string(),
  airtable_external_id:  z.string(),
  airtable_synced_at:    z.string().nullable().optional(),
  full_name:             z.string().nullable(),
  dni:                   z.string().nullable(),
  phone:                 z.string().nullable(),
  email:                 z.string().nullable(),
  employment:            z.string().nullable(),
  company:               z.string().nullable(),
  job_title:             z.string().nullable(),
  industry:              z.string().nullable(),
  status:                z.string().nullable(),
  photo_url:             z.string().nullable(),
});

export type NormalizedResponsableSchemaType = z.infer<typeof NormalizedResponsableSchema>;

// ---------------------------------------------------------------------------
// Pago de servicios (→ service_payments)
// ---------------------------------------------------------------------------

export const NormalizedServicePaymentSchema = z.object({
  org_id:               z.string(),
  airtable_external_id: z.string(),
  airtable_synced_at:   z.string().optional(),
  service_type:         z.enum(['agua', 'internet', 'gas', 'luz', 'otro']),
  supply_number:        z.string().nullable(),
  tope:                 z.number().nullable().optional(),
  monthly_data:         z.record(z.object({
    amount:      z.number().nullable(),
    eecc:        z.string().nullable(),
    receipt_url: z.string().nullable(),
  })),
  _airtable_property_ext_id: z.string().nullable(),
});

export type NormalizedServicePaymentSchemaType = z.infer<typeof NormalizedServicePaymentSchema>;
