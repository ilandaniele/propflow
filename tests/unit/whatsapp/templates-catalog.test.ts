/**
 * Cross-checks WHATSAPP_TEMPLATE_CATALOG against every call site that
 * actually sends these templates, so the catalog can never drift from the
 * names/variable order the code sends.
 */

import { describe, it, expect } from 'vitest';
import { WHATSAPP_TEMPLATE_CATALOG, toGraphPayload } from '@/lib/whatsapp/templates-catalog';
import { VISIT_TEMPLATES } from '@/lib/agent/visits/reminder-jobs';
import { parseFollowupPolicy } from '@/lib/leads/types';

const DEFAULT_FOLLOWUP_POLICY = parseFollowupPolicy(undefined);
import { isVisitButtonReply } from '@/lib/agent/visits/button-reply';

const CONFIRMAR_VISITA_VOZ = 'confirmar_visita_voz';

function catalogNames(): string[] {
  return WHATSAPP_TEMPLATE_CATALOG.map((d) => d.name);
}

describe('WHATSAPP_TEMPLATE_CATALOG', () => {
  it('has exactly 7 templates', () => {
    expect(WHATSAPP_TEMPLATE_CATALOG).toHaveLength(7);
  });

  it('names match the constants used by reminder-jobs.ts (VISIT_TEMPLATES)', () => {
    expect(catalogNames()).toContain(VISIT_TEMPLATES.reminder24h);
    expect(catalogNames()).toContain(VISIT_TEMPLATES.reminder2h);
    expect(catalogNames()).toContain(VISIT_TEMPLATES.postCheck);
  });

  it('names match the followup-policy defaults in leads/types.ts', () => {
    const stepTemplates = DEFAULT_FOLLOWUP_POLICY.steps
      .filter((s) => s.kind === 'template')
      .map((s) => s.template);
    expect(stepTemplates).toContain('seguimiento_lead');
    expect(stepTemplates).toContain('reactivacion_lead');
    expect(catalogNames()).toEqual(expect.arrayContaining(stepTemplates as string[]));

    expect(DEFAULT_FOLLOWUP_POLICY.listingAlerts.template).toBe('propiedad_nueva');
    expect(catalogNames()).toContain(DEFAULT_FOLLOWUP_POLICY.listingAlerts.template);
  });

  it("includes 'confirmar_visita_voz', used by voice/visit-confirmation.ts", () => {
    expect(catalogNames()).toContain(CONFIRMAR_VISITA_VOZ);
  });

  it('every body variable count matches its bodyExamples length', () => {
    for (const def of WHATSAPP_TEMPLATE_CATALOG) {
      const variableCount = new Set(def.body.match(/\{\{\d+\}\}/g) ?? []).size;
      expect(def.bodyExamples).toHaveLength(variableCount);
    }
  });

  it('every quick-reply text is <= 20 chars (Meta limit)', () => {
    for (const def of WHATSAPP_TEMPLATE_CATALOG) {
      for (const text of def.quickReplies ?? []) {
        expect(text.length).toBeLessThanOrEqual(20);
      }
    }
  });

  it("visit reminder/feedback quick replies normalize to button-reply.ts's TEMPLATE_TEXT_MAP keys", () => {
    const visitTemplateNames = [VISIT_TEMPLATES.reminder24h, VISIT_TEMPLATES.reminder2h, VISIT_TEMPLATES.postCheck];
    const expected = ['Confirmo', 'Reprogramar', 'Sí, fui', 'No pude ir'];

    const seen = new Set<string>();
    for (const def of WHATSAPP_TEMPLATE_CATALOG) {
      if (!visitTemplateNames.includes(def.name)) continue;
      for (const text of def.quickReplies ?? []) {
        seen.add(text);
        expect(isVisitButtonReply(text)).toBe(true);
      }
    }
    for (const text of expected) expect(seen.has(text)).toBe(true);
  });

  it('toGraphPayload produces Meta create-template shape (BODY + optional BUTTONS)', () => {
    const def = WHATSAPP_TEMPLATE_CATALOG.find((d) => d.name === 'recordatorio_visita_24h')!;
    const payload = toGraphPayload(def);

    expect(payload).toMatchObject({
      name: 'recordatorio_visita_24h',
      language: 'es',
      category: 'UTILITY',
    });
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components[0]).toMatchObject({
      type: 'BODY',
      text: def.body,
      example: { body_text: [def.bodyExamples] },
    });
    expect(components[1]).toMatchObject({
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Confirmo' },
        { type: 'QUICK_REPLY', text: 'Reprogramar' },
      ],
    });
  });

  it('toGraphPayload sets allow_category_change so Meta can reclassify instead of rejecting', () => {
    for (const def of WHATSAPP_TEMPLATE_CATALOG) {
      expect(toGraphPayload(def)).toMatchObject({ allow_category_change: true });
    }
  });

  it('toGraphPayload omits BUTTONS when the template has no quick replies', () => {
    const def = WHATSAPP_TEMPLATE_CATALOG.find((d) => d.name === 'seguimiento_lead')!;
    const payload = toGraphPayload(def);
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
  });
});
