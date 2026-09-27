/**
 * The 7 WhatsApp message templates the agent needs Meta to approve
 * (blueprint §8 / handoffs/meta-templates.md) — defined once here so the
 * owner never has to retype them into WhatsApp Manager. `meta-templates-api.ts`
 * submits these to the Graph API; the names/variable order must stay in sync
 * with the code that actually sends them (see the unit test for the list of
 * call sites this is cross-checked against).
 *
 * Texts, categories, variable order and quick-reply labels are copied
 * verbatim from handoffs/meta-templates.md — do not edit the wording here
 * without updating that doc too.
 */

export interface TemplateDefinition {
  name: string;
  category: 'UTILITY' | 'MARKETING';
  language: 'es';
  body: string;
  /** One example string per `{{n}}` placeholder in `body`, in order. */
  bodyExamples: string[];
  /** Quick-reply button labels, Meta limit 20 chars each. */
  quickReplies?: string[];
  /** Where in the codebase this template name is used — for the test cross-check, not sent to Meta. */
  usedBy: string;
}

export const WHATSAPP_TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    name: 'recordatorio_visita_24h',
    category: 'UTILITY',
    language: 'es',
    body: 'Hola {{1}}, te recordamos tu visita a *{{2}}* mañana, {{3}}. ¿Nos confirmás tu asistencia?',
    bodyExamples: ['María', 'Depto 2 dorm. Miraflores', 'jueves 10 de octubre, 10:00'],
    quickReplies: ['Confirmo', 'Reprogramar'],
    usedBy: 'src/lib/agent/visits/reminder-jobs.ts (VISIT_TEMPLATES.reminder24h)',
  },
  {
    name: 'recordatorio_visita_2h',
    category: 'UTILITY',
    language: 'es',
    body: 'Hola {{1}}, tu visita a *{{2}}* es hoy a las {{3}}. ¡Te esperamos!',
    bodyExamples: ['María', 'Depto 2 dorm. Miraflores', '16:00'],
    quickReplies: ['Confirmo', 'Reprogramar'],
    usedBy: 'src/lib/agent/visits/reminder-jobs.ts (VISIT_TEMPLATES.reminder2h)',
  },
  {
    name: 'feedback_post_visita',
    category: 'UTILITY',
    language: 'es',
    body: 'Hola {{1}}, ¿pudiste visitar *{{2}}* ({{3}})? Contanos cómo te fue.',
    bodyExamples: ['María', 'Depto 2 dorm. Miraflores', 'jueves 10 de octubre'],
    quickReplies: ['Sí, fui', 'No pude ir'],
    usedBy: 'src/lib/agent/visits/reminder-jobs.ts (VISIT_TEMPLATES.postCheck)',
  },
  {
    name: 'seguimiento_lead',
    category: 'MARKETING',
    language: 'es',
    body: 'Hola {{1}}, ¿seguís buscando propiedad? Respondé este mensaje y te mostramos opciones que encajan con lo que buscás.',
    bodyExamples: ['María'],
    usedBy: "src/lib/leads/types.ts (default followup step template: 'seguimiento_lead')",
  },
  {
    name: 'reactivacion_lead',
    category: 'MARKETING',
    language: 'es',
    body: 'Hola {{1}}, tenemos nuevas propiedades disponibles. ¿Querés que te enviemos algunas opciones?',
    bodyExamples: ['María'],
    usedBy: "src/lib/leads/types.ts (default followup step template: 'reactivacion_lead')",
  },
  {
    name: 'propiedad_nueva',
    category: 'MARKETING',
    language: 'es',
    body: 'Hola {{1}}, entró una propiedad que coincide con tu búsqueda: *{{2}}* — {{3}}. ¿Querés más información o agendar una visita?',
    bodyExamples: ['María', 'Depto 2 dorm. Miraflores', 'S/ 2,500'],
    usedBy: "src/lib/leads/types.ts (default listingAlerts.template: 'propiedad_nueva')",
  },
  {
    name: 'confirmar_visita_voz',
    category: 'UTILITY',
    language: 'es',
    body: 'Hola {{1}}, como hablamos por teléfono: visita a *{{2}}* el {{3}}. Para confirmarla, tocá el botón o respondé *Confirmo {{4}}*.',
    bodyExamples: ['María', 'Depto 2 dorm. Miraflores', 'jueves 10 de octubre, 10:00', 'VOZ-7K3P9Q'],
    quickReplies: ['Confirmar visita'],
    usedBy: "src/lib/agent/voice/visit-confirmation.ts ('confirmar_visita_voz')",
  },
];

/** Number of `{{n}}` placeholders referenced in a template body. */
function countVariables(body: string): number {
  const matches = body.match(/\{\{\d+\}\}/g);
  return matches ? new Set(matches).size : 0;
}

export function toGraphPayload(def: TemplateDefinition): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    {
      type: 'BODY',
      text: def.body,
      example: { body_text: [def.bodyExamples] },
    },
  ];

  if (def.quickReplies) {
    components.push({
      type: 'BUTTONS',
      buttons: def.quickReplies.map((text) => ({ type: 'QUICK_REPLY', text })),
    });
  }

  return {
    name: def.name,
    language: def.language,
    category: def.category,
    // Lets Meta auto-reclassify the category (e.g. UTILITY -> MARKETING) at
    // review time instead of rejecting the submission outright.
    allow_category_change: true,
    components,
  };
}

// Exported for the unit test's variable-count assertion (avoids duplicating
// the {{n}}-counting regex there).
export const __private = { countVariables };
