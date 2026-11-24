import { describe, it, expect } from 'vitest';
import {
  CreateDefinitionSchema,
  UpdateDefinitionSchema,
  coerceFieldValue,
  fieldInputName,
  parseFieldValues,
  type CustomFieldDefinitionShape,
} from '@/lib/custom-fields/schemas';

function def(fieldType: CustomFieldDefinitionShape['fieldType'], extra: Partial<CustomFieldDefinitionShape> = {}): CustomFieldDefinitionShape {
  return { id: crypto.randomUUID(), fieldType, required: false, options: null, ...extra };
}

describe('coerceFieldValue', () => {
  it('text: trims, caps length, clears when empty', () => {
    expect(coerceFieldValue(def('text'), '  hola ')).toEqual({ ok: true, value: 'hola' });
    expect(coerceFieldValue(def('text'), '   ')).toEqual({ ok: true, value: null });
    expect(coerceFieldValue(def('text'), 'x'.repeat(501))).toEqual({ ok: false, error: 'invalid' });
  });

  it('number: accepts decimals and negatives, normalizes, rejects junk', () => {
    expect(coerceFieldValue(def('number'), '012.50')).toEqual({ ok: true, value: '12.5' });
    expect(coerceFieldValue(def('number'), '-3')).toEqual({ ok: true, value: '-3' });
    for (const bad of ['abc', '1e5', '1,5', 'Infinity', '1.1234567']) {
      expect(coerceFieldValue(def('number'), bad)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('date: accepts real ISO dates only', () => {
    expect(coerceFieldValue(def('date'), '2026-02-28')).toEqual({ ok: true, value: '2026-02-28' });
    expect(coerceFieldValue(def('date'), '2026-02-30')).toEqual({ ok: false, error: 'invalid' });
    expect(coerceFieldValue(def('date'), '28/02/2026')).toEqual({ ok: false, error: 'invalid' });
  });

  it('boolean: checkbox on is true, absent is false', () => {
    expect(coerceFieldValue(def('boolean'), 'on')).toEqual({ ok: true, value: 'true' });
    expect(coerceFieldValue(def('boolean'), null)).toEqual({ ok: true, value: 'false' });
    expect(coerceFieldValue(def('boolean', { required: true }), null)).toEqual({ ok: true, value: 'false' });
  });

  it('select: only defined options', () => {
    const field = def('select', { options: ['Norte', 'Sur'] });
    expect(coerceFieldValue(field, 'Sur')).toEqual({ ok: true, value: 'Sur' });
    expect(coerceFieldValue(field, 'Este')).toEqual({ ok: false, error: 'invalid' });
  });

  it('required fields reject empty and missing values', () => {
    expect(coerceFieldValue(def('text', { required: true }), '')).toEqual({ ok: false, error: 'required' });
    expect(coerceFieldValue(def('number', { required: true }), null)).toEqual({ ok: false, error: 'required' });
  });

  it('rejects File entries', () => {
    expect(coerceFieldValue(def('text', { required: true }), new File(['x'], 'x.txt'))).toEqual({ ok: false, error: 'required' });
  });
});

describe('parseFieldValues', () => {
  it('collects values per definition and ignores unknown inputs', () => {
    const text = def('text');
    const flag = def('boolean');
    const form = new FormData();
    form.set(fieldInputName(text.id), 'abc');
    form.set(fieldInputName(crypto.randomUUID()), 'injected');
    expect(parseFieldValues([text, flag], form)).toEqual({
      ok: true,
      values: [{ definitionId: text.id, value: 'abc' }, { definitionId: flag.id, value: 'false' }],
    });
  });

  it('returns field errors keyed by definition id', () => {
    const required = def('text', { required: true });
    const number = def('number');
    const form = new FormData();
    form.set(fieldInputName(number.id), 'nope');
    expect(parseFieldValues([required, number], form)).toEqual({
      ok: false,
      fieldErrors: { [required.id]: ['required'], [number.id]: ['invalid'] },
    });
  });
});

describe('CreateDefinitionSchema', () => {
  const base = { entity_type: 'unit', key: 'parking_spot', field_type: 'text', label: ' Cochera ' };

  it('parses a valid definition with defaults', () => {
    const parsed = CreateDefinitionSchema.parse(base);
    expect(parsed).toMatchObject({ label: 'Cochera', required: false, sort_order: 0 });
  });

  it('parses checkbox and options textarea', () => {
    const parsed = CreateDefinitionSchema.parse({ ...base, field_type: 'select', required: 'on', options: 'A\n B \n\nA\nC' });
    expect(parsed.required).toBe(true);
    expect(parsed.options).toEqual(['A', 'B', 'C']);
  });

  it('rejects bad keys, unknown types and entities', () => {
    for (const key of ['Parking', '1abc', 'with space', 'a'.repeat(41), '']) {
      expect(CreateDefinitionSchema.safeParse({ ...base, key }).success).toBe(false);
    }
    expect(CreateDefinitionSchema.safeParse({ ...base, field_type: 'json' }).success).toBe(false);
    expect(CreateDefinitionSchema.safeParse({ ...base, entity_type: 'payment' }).success).toBe(false);
  });

  it('requires options for select fields', () => {
    expect(CreateDefinitionSchema.safeParse({ ...base, field_type: 'select' }).success).toBe(false);
    expect(CreateDefinitionSchema.safeParse({ ...base, field_type: 'select', options: ' \n ' }).success).toBe(false);
  });

  it('caps sort order and label length', () => {
    expect(CreateDefinitionSchema.safeParse({ ...base, sort_order: '1000' }).success).toBe(false);
    expect(CreateDefinitionSchema.safeParse({ ...base, label: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('UpdateDefinitionSchema', () => {
  it('requires a uuid id and ignores key/type changes', () => {
    expect(UpdateDefinitionSchema.safeParse({ id: 'nope', label: 'X' }).success).toBe(false);
    const parsed = UpdateDefinitionSchema.parse({ id: crypto.randomUUID(), label: 'X', key: 'hack', field_type: 'number' });
    expect(parsed).not.toHaveProperty('key');
    expect(parsed).not.toHaveProperty('field_type');
  });
});
