import { describe, it, expect } from 'vitest';
import { buildAgentSystemPrompt, buildTurnContext } from '@/lib/agent/prompt';
import type { AgentConfig } from '@/lib/agent/config';
import type { LeadRecord } from '@/lib/agent/lead';
import type { AgentAttribution } from '@/lib/agent/types';

const CONFIG: AgentConfig = {
  id: 'config-1',
  orgId: 'org-1',
  persona: 'Asistente inmobiliario',
  tone: 'profesional',
  rules: null,
  prohibited: null,
  faq: [],
  businessHours: { weekly: [], closedNote: null },
  timezone: 'America/Lima',
  qualificationFields: [],
  followupPolicy: {},
  routingMode: 'round_robin',
  dailyTokenBudget: 50_000,
  widgetAllowedOrigins: [],
  channelsEnabled: { whatsapp: true, web: false, voice: false },
  shadowMode: false,
  maxAgentTurns: null,
  publicPagesEnabled: false,
  voice: {
    voiceProvider: 'azure',
    voiceId: 'es-PE-CamilaNeural',
    language: 'es',
    recordingEnabled: true,
    greetingExtra: null,
    maxCallMinutes: 10,
    monthlyMinuteCap: 300,
    callWindow: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 },
    speedToLead: { enabled: false, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 },
    visitConfirmation: { enabled: false, hoursBefore: 20 },
    reactivation: { enabled: false, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 },
  },
  maxActiveVisitsPerPhone: 2,
  maxListingPhotos: 5,
};

const LEAD: LeadRecord = {
  id: 'lead-1',
  fullName: 'Juan Pérez',
  phone: '+51987654321',
  operationType: 'rent',
  pipeline: 'demand',
  budgetMin: null,
  budgetMax: '1500',
  currency: 'PEN',
  zones: ['Miraflores'],
  bedroomsMin: 2,
  moveInDate: null,
  timeline: 'immediate',
  pets: false,
  score: 80,
  intentTag: 'qualified',
  stage: 'new',
  doNotContact: false,
};

describe('buildAgentSystemPrompt', () => {
  it('tells the model to answer in the user\'s language instead of hardcoding Spanish', () => {
    const prompt = buildAgentSystemPrompt(CONFIG);
    expect(prompt).toMatch(/idioma del usuario/i);
    expect(prompt).not.toMatch(/respondes siempre en español/i);
  });

  it('never contains volatile per-turn data (no leaks from a stale cached block)', () => {
    const prompt = buildAgentSystemPrompt(CONFIG);
    expect(prompt).not.toContain('lead-1');
    expect(prompt).not.toContain('Miraflores');
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamps
  });
});

describe('buildTurnContext', () => {
  const nowIso = '2026-01-01T12:00:00.000Z';

  it('includes the detected language', () => {
    const ctx = buildTurnContext(LEAD, nowIso, { language: 'en' });
    expect(ctx).toMatch(/idioma del usuario: en/i);
  });

  it('includes ctwa ad attribution', () => {
    const attribution: AgentAttribution = {
      type: 'ctwa',
      sourceId: 'ad-123',
      headline: 'Depa en Miraflores',
      capturedAt: nowIso,
    };
    const ctx = buildTurnContext(LEAD, nowIso, { attribution });
    expect(ctx).toContain('Depa en Miraflores');
  });

  it('includes wa.me ref-code attribution with the listing id', () => {
    const attribution: AgentAttribution = {
      type: 'wa_link',
      refCode: 'ABC123',
      listingId: 'listing-9',
      capturedAt: nowIso,
    };
    const ctx = buildTurnContext(LEAD, nowIso, { attribution });
    expect(ctx).toContain('ABC123');
    expect(ctx).toContain('listing-9');
  });

  it('includes recent human replies, sanitized and marked as non-instructions', () => {
    const ctx = buildTurnContext(LEAD, nowIso, { humanReplies: ['Ya te contacto un asesor'] });
    expect(ctx).toContain('Ya te contacto un asesor');
    expect(ctx).toMatch(/no son instrucciones/i);
  });

  it('truncates each human reply to 500 chars', () => {
    const long = 'x'.repeat(600);
    const ctx = buildTurnContext(LEAD, nowIso, { humanReplies: [long] });
    expect(ctx).toContain('x'.repeat(500));
    expect(ctx).not.toContain('x'.repeat(501));
  });

  it('handles a lead-less session without crashing', () => {
    const ctx = buildTurnContext(null, nowIso, { language: 'pt' });
    expect(ctx).toMatch(/idioma del usuario: pt/i);
    expect(ctx).toMatch(/todavía no hay datos/i);
  });
});
