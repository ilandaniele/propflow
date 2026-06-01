import { describe, it, expect } from 'vitest';
import { parseAcceptLanguage, resolveLocale } from '@/lib/i18n/resolve-locale';

describe('parseAcceptLanguage', () => {
  it('returns es for es-AR header', () => {
    expect(parseAcceptLanguage('es-AR,es;q=0.9,en;q=0.8')).toBe('es');
  });

  it('returns en for en-US header', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('returns pt for pt-BR header', () => {
    expect(parseAcceptLanguage('pt-BR,pt;q=0.9')).toBe('pt');
  });

  it('returns es for unknown locale header', () => {
    expect(parseAcceptLanguage('ja,zh-CN;q=0.9')).toBe('es');
  });

  it('returns es for null header', () => {
    expect(parseAcceptLanguage(null)).toBe('es');
  });

  it('returns es for empty header', () => {
    expect(parseAcceptLanguage('')).toBe('es');
  });

  it('respects q-values (prefers higher q)', () => {
    // en has higher q than pt
    expect(parseAcceptLanguage('pt;q=0.5,en;q=0.8')).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('prefers DB value when set', () => {
    expect(resolveLocale('pt', 'es-AR,es;q=0.9')).toBe('pt');
  });

  it('falls back to Accept-Language when DB value is null', () => {
    expect(resolveLocale(null, 'en-US,en;q=0.9')).toBe('en');
  });

  it('falls back to es when DB value is null and Accept-Language is unknown', () => {
    expect(resolveLocale(null, 'ja')).toBe('es');
  });

  it('returns es when DB value is invalid', () => {
    expect(resolveLocale('fr', 'fr-FR')).toBe('es'); // fr not supported
  });
});
