/**
 * write.ts — Airtable write-back service (server-only).
 *
 * NEVER import from 'use client' components.
 * All Airtable credentials are read from server-side env vars only.
 */

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

export interface UpsertAirtableResidenteResult {
  airtableRecordId: string;
  created: boolean;
}

interface ResidenteFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  dni?: string | null;
  birth_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

/**
 * Creates or updates a Residentes record in Airtable.
 * Uses the record ID if provided (update path), otherwise creates a new record.
 *
 * @param tenant             Tenant fields to write
 * @param existingAirtableId Existing Airtable record ID (PATCH) or null/undefined (POST)
 * @returns { airtableRecordId, created }
 * @throws Error on HTTP errors other than 404 (404 on PATCH retries as POST)
 */
export async function upsertAirtableResidente(
  tenant: ResidenteFields,
  existingAirtableId?: string | null
): Promise<UpsertAirtableResidenteResult> {
  const pat       = process.env['AIRTABLE_PAT'];
  const baseId    = process.env['AIRTABLE_BASE_ID'];
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;

  if (!pat || !baseId || !tableName) {
    throw new Error('[airtable/write] Airtable not configured: AIRTABLE_PAT, AIRTABLE_BASE_ID, or AIRTABLE_TABLE_RESIDENTES missing');
  }

  // Build fields — omit null/undefined values
  const fields: Record<string, string> = {
    'Nombre(s)':           tenant.first_name,
    'Apellidos':           tenant.last_name,
    'Correo electrónico':  tenant.email,
    'Número celular':      tenant.phone,
  };
  if (tenant.dni)         fields['N° DNI']              = tenant.dni;
  if (tenant.birth_date)  fields['Fecha de nacimiento'] = tenant.birth_date;

  const tableUrl = `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(tableName)}`;
  const headers  = {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  };

  // PATCH if we have an existing ID
  if (existingAirtableId) {
    const res = await fetch(`${tableUrl}/${existingAirtableId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields }),
      cache: 'no-store',
    });

    if (res.status === 404) {
      // Record was deleted in Airtable — fall through to create
      return createResidenteRecord(tableUrl, headers, fields);
    }

    if (!res.ok) {
      throw new Error(`[airtable/write] PATCH failed: HTTP ${res.status}`);
    }

    const data = await res.json() as { id?: string };
    if (!data.id) throw new Error('[airtable/write] PATCH response missing record id');
    return { airtableRecordId: data.id, created: false };
  }

  return createResidenteRecord(tableUrl, headers, fields);
}

async function createResidenteRecord(
  tableUrl: string,
  headers: Record<string, string>,
  fields: Record<string, string>
): Promise<UpsertAirtableResidenteResult> {
  const res = await fetch(tableUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`[airtable/write] POST failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error('[airtable/write] POST response missing record id');
  return { airtableRecordId: data.id, created: true };
}
