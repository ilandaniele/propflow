import { describe, it, expect } from 'vitest';
import { normalizeFeedback } from '@/lib/airtable/normalizers/normalizeFeedback';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const rec = (fields: Record<string, unknown>, id = 'recFB1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeFeedback', () => {
  it('maps scores and the resident link', () => {
    const r = normalizeFeedback(rec({
      'Residente': ['recTEN1'], 'Fecha': '2026-07-01',
      'Limpieza': 5, 'Convivencia': 4, 'Atención al residente': 3,
      'Seguridad': 4, 'Calidad - Precio': 5,
      'Recomendaría': true, 'Comentario': 'Todo bien',
    }));
    expect(r).toMatchObject({
      airtableExternalId: 'recFB1', tenantAirtableId: 'recTEN1', fecha: '2026-07-01',
      cleaningScore: 5, coexistenceScore: 4, attentionScore: 3,
      securityScore: 4, valueScore: 5, wouldRecommend: true, comment: 'Todo bien',
    });
  });

  it('clamps out-of-range scores to null and rounds fractional scores', () => {
    const r = normalizeFeedback(rec({ 'Limpieza': 6, 'Convivencia': 0, 'Seguridad': 3.4 }));
    expect(r!.cleaningScore).toBeNull();  // > 5
    expect(r!.coexistenceScore).toBeNull(); // < 1
    expect(r!.securityScore).toBe(3);       // rounded
  });

  it('wouldRecommend is strictly boolean (true/false/null only)', () => {
    expect(normalizeFeedback(rec({ 'Recomendaría': true }))!.wouldRecommend).toBe(true);
    expect(normalizeFeedback(rec({ 'Recomendaría': false }))!.wouldRecommend).toBe(false);
    expect(normalizeFeedback(rec({ 'Recomendaría': 'yes' }))!.wouldRecommend).toBeNull();
    expect(normalizeFeedback(rec({}))!.wouldRecommend).toBeNull();
  });
});
