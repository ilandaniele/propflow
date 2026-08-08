import { describe, it, expect } from 'vitest';
import { normalizeTrashCompliance } from '@/lib/airtable/normalizers/normalizeTrashCompliance';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const ORG = '00000000-0000-0000-0000-000000000001';
const rec = (fields: Record<string, unknown>, id = 'recTC1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeTrashCompliance', () => {
  it('maps fields, extracts Turno + Residente links, and the first photo URL', () => {
    const r = normalizeTrashCompliance(rec({
      'Name': 'Cumplimiento 1', 'Fecha': '2026-07-05', 'Estado': 'Cumplido',
      'Turno': ['recTURNO1'], 'Residente': ['recTEN1'],
      'Foto': [{ url: 'https://cdn.airtable.com/trash.jpg' }],
    }), ORG);
    expect(r).toMatchObject({
      org_id: ORG, airtable_external_id: 'recTC1', name: 'Cumplimiento 1',
      fecha: '2026-07-05', estado: 'Cumplido',
      foto_url: 'https://cdn.airtable.com/trash.jpg',
      _airtable_trash_schedule_ext_id: 'recTURNO1',
      _airtable_tenant_ext_id: 'recTEN1',
    });
  });

  it('nulls the photo url and links when absent', () => {
    const r = normalizeTrashCompliance(rec({ 'Estado': 'Pendiente', 'Foto': [] }), ORG);
    expect(r.foto_url).toBeNull();
    expect(r._airtable_trash_schedule_ext_id).toBeNull();
    expect(r._airtable_tenant_ext_id).toBeNull();
  });
});
