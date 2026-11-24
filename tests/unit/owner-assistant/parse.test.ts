import { describe, it, expect } from 'vitest';
import { parseAmount, parseOwnerCommand } from '@/lib/owner-assistant/parse';

describe('parseAmount', () => {
  it.each([
    ['120', 120],
    ['120.50', 120.5],
    ['120,50', 120.5],
    ['1.200', 1200],
    ['1,200.50', 1200.5],
    ['1.200,50', 1200.5],
    ['S/120', 120],
    ['s/.85', 85],
  ])('%s -> %d', (token, expected) => {
    expect(parseAmount(token)).toBe(expected);
  });

  it.each(['0', 'abc', '', '-5', 'S/', '12a'])('rejects %s', (token) => {
    expect(parseAmount(token)).toBeNull();
  });
});

describe('parseOwnerCommand', () => {
  it('parses link codes', () => {
    expect(parseOwnerCommand('VINCULAR 123456')).toEqual({ kind: 'link', code: '123456' });
    expect(parseOwnerCommand('vincular 12345')).toEqual({ kind: 'unknown' });
  });

  it('parses help words', () => {
    for (const word of ['ayuda', 'HELP', 'Ajuda', 'menú']) expect(parseOwnerCommand(word)).toEqual({ kind: 'help' });
  });

  it('parses expenses with accents and filler words', () => {
    expect(parseOwnerCommand('Gasté 120 en pintura del depto')).toEqual({ kind: 'expense', amount: 120, description: 'pintura del depto' });
    expect(parseOwnerCommand('gasto S/ 45,50 luz')).toEqual({ kind: 'expense', amount: 45.5, description: 'luz' });
    expect(parseOwnerCommand('gasto 45,50')).toEqual({ kind: 'expense', amount: 45.5, description: '' });
  });

  it('parses payments only with a tenant query', () => {
    expect(parseOwnerCommand('PAGO 1500 de Juan Pérez')).toEqual({ kind: 'payment', amount: 1500, tenantQuery: 'Juan Pérez' });
    expect(parseOwnerCommand('pago 1500')).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for empty, null or unrelated text', () => {
    expect(parseOwnerCommand(null)).toEqual({ kind: 'unknown' });
    expect(parseOwnerCommand('   ')).toEqual({ kind: 'unknown' });
    expect(parseOwnerCommand('hola que tal')).toEqual({ kind: 'unknown' });
  });

  it('caps description length', () => {
    const cmd = parseOwnerCommand(`gasto 10 ${'x'.repeat(300)}`);
    expect(cmd.kind === 'expense' && cmd.description.length).toBe(200);
  });
});
