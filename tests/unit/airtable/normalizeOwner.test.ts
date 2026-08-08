import { describe, it, expect } from 'vitest';
import { normalizeOwner } from '@/lib/airtable/normalizers/normalizeOwner';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const ORG = '00000000-0000-0000-0000-000000000001';
const rec = (fields: Record<string, unknown>, id = 'recOWN1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeOwner', () => {
  it('maps owner + co-owner fields', () => {
    const r = normalizeOwner(rec({
      'Name': 'Juan Pérez', 'N° DNI': '12345678', 'Número celular': '999888777',
      'Correo electrónico': 'juan@x.com', 'Propietario #2': 'Ana Pérez',
      'N° DNI #2': '87654321', 'Distrito': 'Miraflores',
    }), ORG);
    expect(r).toMatchObject({
      org_id: ORG, airtable_external_id: 'recOWN1',
      name: 'Juan Pérez', dni: '12345678', phone: '999888777', email: 'juan@x.com',
      co_owner_name: 'Ana Pérez', co_owner_dni: '87654321', distrito: 'Miraflores',
    });
  });

  it('nulls absent co-owner and coerces a numeric DNI to string', () => {
    const r = normalizeOwner(rec({ 'Name': 'Solo', 'N° DNI': 12345678 }), ORG);
    expect(r.dni).toBe('12345678');
    expect(r.co_owner_name).toBeNull();
    expect(r.co_owner_email).toBeNull();
  });
});
