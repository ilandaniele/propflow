import { describe, it, expect } from 'vitest';
import { detectLanguage } from '@/lib/agent/language';

describe('detectLanguage', () => {
  it('detects Spanish', () => {
    expect(detectLanguage('Hola, quiero saber el precio de la casa por favor')).toBe('es');
  });

  it('detects English', () => {
    expect(detectLanguage('Hello, I want to know the price of the house please')).toBe('en');
  });

  it('detects Portuguese', () => {
    expect(detectLanguage('Olá, quero saber o preço da casa por favor')).toBe('pt');
  });

  it('returns null for a short/ambiguous greeting', () => {
    expect(detectLanguage('ok')).toBeNull();
  });

  it('returns null when the text has fewer than 2 tokens', () => {
    expect(detectLanguage('hola')).toBeNull();
  });

  it('returns null on evenly mixed input with no clear winner', () => {
    // "the" (en) and "la" (es) each score once — tied, not a confident signal.
    expect(detectLanguage('the la')).toBeNull();
  });
});
