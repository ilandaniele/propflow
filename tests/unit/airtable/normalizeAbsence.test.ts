import { describe, it, expect } from 'vitest';
import { normalizeAbsence } from '@/lib/airtable/normalizers/normalizeAbsence';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const ORG = '00000000-0000-0000-0000-000000000001';
const rec = (fields: Record<string, unknown>, id = 'recABS1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeAbsence', () => {
  it('maps fields, truncates dates to YYYY-MM-DD, and extracts the tenant link', () => {
    const r = normalizeAbsence(rec({
      'Name': 'Ausencia Ana', 'Fecha inicio': '2026-07-10T00:00:00.000Z',
      'Fecha fin': '2026-07-20', 'Estado': 'aprobada', 'Motivo': 'Viaje',
      'Residente': ['recTEN1'],
    }), ORG);
    expect(r).toMatchObject({
      org_id: ORG, airtable_external_id: 'recABS1', name: 'Ausencia Ana',
      fecha_inicio: '2026-07-10', fecha_fin: '2026-07-20',
      estado: 'aprobada', motivo: 'Viaje', _airtable_tenant_ext_id: 'recTEN1',
    });
  });

  it('nulls a missing/non-string date and an absent tenant link', () => {
    const r = normalizeAbsence(rec({ 'Name': 'X', 'Fecha inicio': 12345 }), ORG);
    expect(r.fecha_inicio).toBeNull();
    expect(r._airtable_tenant_ext_id).toBeNull();
  });
});
