/**
 * normalizeFeedback — server-only.
 *
 * Maps a raw Airtable record from the Feedback table to a row
 * ready to upsert into public.tenant_feedback.
 *
 * Fields: Residente, Propiedad, Fecha, Limpieza, Convivencia,
 *         Atención al residente, Seguridad, Calidad - Precio,
 *         Recomendaría, Comentario, Peor experiencia
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';

export const FEEDBACK_FIELD = {
  RESIDENT_LINK:  'Residente',
  FECHA:          'Fecha',
  CLEANING:       'Limpieza',
  COEXISTENCE:    'Convivencia',
  ATTENTION:      'Atención al residente',
  SECURITY:       'Seguridad',
  VALUE:          'Calidad - Precio',
  RECOMMEND:      'Recomendaría',
  COMMENT:        'Comentario',
  WORST:          'Peor experiencia',
} as const;

export interface NormalizedFeedback {
  airtableExternalId: string;
  tenantAirtableId:   string | null;
  fecha:              string | null;
  cleaningScore:      number | null;
  coexistenceScore:   number | null;
  attentionScore:     number | null;
  securityScore:      number | null;
  valueScore:         number | null;
  wouldRecommend:     boolean | null;
  comment:            string | null;
  worstExperience:    string | null;
}

function toScore(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (isNaN(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

function toStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

export function normalizeFeedback(record: AirtableRecord): NormalizedFeedback | null {
  const f = record.fields;

  return {
    airtableExternalId: record.id,
    tenantAirtableId:   extractFirstLinkedId(f[FEEDBACK_FIELD.RESIDENT_LINK]),
    fecha:              toStr(f[FEEDBACK_FIELD.FECHA]),
    cleaningScore:      toScore(f[FEEDBACK_FIELD.CLEANING]),
    coexistenceScore:   toScore(f[FEEDBACK_FIELD.COEXISTENCE]),
    attentionScore:     toScore(f[FEEDBACK_FIELD.ATTENTION]),
    securityScore:      toScore(f[FEEDBACK_FIELD.SECURITY]),
    valueScore:         toScore(f[FEEDBACK_FIELD.VALUE]),
    wouldRecommend:     f[FEEDBACK_FIELD.RECOMMEND] === true ? true
                        : f[FEEDBACK_FIELD.RECOMMEND] === false ? false : null,
    comment:            toStr(f[FEEDBACK_FIELD.COMMENT]),
    worstExperience:    toStr(f[FEEDBACK_FIELD.WORST]),
  };
}
