/**
 * Contract PDF template variables — IC-B1
 *
 * PDF rendering lives in pdf-document.tsx (browser only, see pdf-client.ts).
 * Variables are a FIXED ALLOWLIST resolved from DB — no user template execution.
 * The allowlist prevents template injection (OWASP A05).
 */

import type { OrgSignature } from './org-signature';

// ── Allowed template variables ────────────────────────────────────────────────
export const ALLOWED_VARIABLES = [
  'tenant_name',
  'tenant_email',
  'unit_label',
  'property_name',
  'property_address',
  'start_date',
  'end_date',
  'monthly_rent',
  'deposit',
  'org_name',
  'generated_date',
  'tenant_phone',
  'tenant_document',
  'payment_day',
  'duration_months',
  'property_district',
  'contract_code',
  'landlord_name',
  'landlord_document',
] as const;

export type AllowedVariable = typeof ALLOWED_VARIABLES[number];

export type ContractVariables = Partial<Record<AllowedVariable, string>>;

export interface ContractPdfSource {
  templateName: string;
  bodyMarkdown: string;
  variables: ContractVariables;
  signature: OrgSignature | null;
}

/**
 * Interpolate template variables in a markdown body.
 * Only allowlisted {{variable}} tokens are replaced.
 */
export function interpolateTemplate(
  bodyMarkdown: string,
  variables: ContractVariables
): string {
  let result = bodyMarkdown;
  for (const key of ALLOWED_VARIABLES) {
    const value = variables[key] ?? `{{${key}}}`;
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
