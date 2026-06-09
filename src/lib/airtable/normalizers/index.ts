/**
 * Barrel export for Airtable entity normalizers.
 *
 * Each normalizer is a pure function: (AirtableRecord, orgId) → NormalizedEntity.
 * No side effects, no DB calls — safe to import in server-only modules.
 *
 * AC9: read-only toward Airtable — normalizers never issue HTTP calls.
 */

export { normalizeProperty, PROPERTY_FIELD }   from './normalizeProperty';
export { normalizeTenant, TENANT_FIELD }       from './normalizeTenant';
export { normalizeContract, CONTRACT_FIELD, mapContractStatus } from './normalizeContract';
export { normalizePayment, PAYMENT_FIELD }     from './normalizePayment';
export { normalizePortafolio, PORTAFOLIO_FIELD, type NormalizedUnit }       from './normalizePortafolio';
export { normalizeResponsable, RESPONSABLE_FIELD, type NormalizedResponsable } from './normalizeResponsable';
