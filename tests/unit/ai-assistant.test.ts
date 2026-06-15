import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, redactPiiFromUserMessage } from '@/lib/ai/assistant';
import type { OrgContext } from '@/lib/ai/assistant';

const mockCtx: OrgContext = {
  orgName: 'Test Properties LLC',
  totalUnits: 20,
  occupiedUnits: 17,
  occupancyRate: 85,
  overdueTenantsCount: 3,
  openIncidentsCount: 5,
  totalApprovedIncomeThisMonth: 25000,
  totalExpensesThisMonth: 8000,
  netThisMonth: 17000,
};

describe('buildSystemPrompt', () => {
  it('includes org name from context', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt).toContain('Test Properties LLC');
  });

  it('includes occupancy rate as aggregate (no PII)', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt).toContain('85%');
    // Should contain occupancy % and general counts but not individual tenant names/emails
    expect(prompt).toMatch(/occupancy/i);
    expect(prompt).not.toMatch(/\btenant@/i);
  });

  it('includes overdue count', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt).toContain('3'); // 3 overdue
  });

  it('includes income/expense aggregates', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt).toContain('25000.00');
    expect(prompt).toContain('8000.00');
    expect(prompt).toContain('17000.00');
  });

  it('contains system-prompt refusal instruction (LLM06)', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt.toLowerCase()).toContain('system prompt');
    expect(prompt.toLowerCase()).toContain('refuse');
  });

  it('states read-only / no data mutation (LLM08)', () => {
    const prompt = buildSystemPrompt(mockCtx);
    expect(prompt.toUpperCase()).toContain('READ-ONLY');
  });

  it('does not include raw tenant PII (no emails, no phone numbers)', () => {
    const prompt = buildSystemPrompt(mockCtx);
    // No email patterns or phone patterns in the generated prompt
    expect(prompt).not.toMatch(/[\w._%+-]+@[\w.-]+\.\w{2,}/);
    expect(prompt).not.toMatch(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
  });
});

describe('redactPiiFromUserMessage', () => {
  it('redacts SSN pattern', () => {
    const result = redactPiiFromUserMessage('SSN is 123-45-6789');
    expect(result).toContain('[SSN]');
    expect(result).not.toContain('123-45-6789');
  });

  it('redacts email addresses', () => {
    const result = redactPiiFromUserMessage('contact john@example.com please');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('john@example.com');
  });

  it('redacts phone numbers', () => {
    const result = redactPiiFromUserMessage('call 555-123-4567 tomorrow');
    expect(result).toContain('[PHONE]');
    expect(result).not.toContain('555-123-4567');
  });

  it('leaves normal text intact', () => {
    const text = 'What is my occupancy rate?';
    expect(redactPiiFromUserMessage(text)).toBe(text);
  });
});
