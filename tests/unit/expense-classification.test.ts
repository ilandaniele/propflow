import { describe, it, expect } from 'vitest';
import { CreateExpenseCategorySchema, CreateExpenseSchema, UpdateExpenseSchema } from '@/lib/schemas/finance';
import { buildCategoryTree, categoryOptions, totalsByKind } from '@/lib/expenses/categories';
import { resolveKind, resolveMonth } from '@/lib/expenses/filters';

const GUID = '11111111-1111-4111-8111-111111111111';
const baseExpense = { amount: '10', description: 'Luz', incurred_on: '2026-11-02' };

describe('expense schemas', () => {
  it('defaults kind to ordinary and turns empty selects into undefined', () => {
    const parsed = CreateExpenseSchema.parse({ ...baseExpense, category_id: '', property_id: '', unit_id: '' });
    expect(parsed).toMatchObject({ kind: 'ordinary', category_id: undefined, property_id: undefined, unit_id: undefined });
  });

  it('accepts extraordinary and rejects unknown kinds', () => {
    expect(CreateExpenseSchema.parse({ ...baseExpense, kind: 'extraordinary' }).kind).toBe('extraordinary');
    expect(CreateExpenseSchema.safeParse({ ...baseExpense, kind: 'weird' }).success).toBe(false);
  });

  it('keeps kind optional on update', () => {
    expect(UpdateExpenseSchema.parse({ id: GUID }).kind).toBeUndefined();
  });

  it('accepts an optional parent category', () => {
    expect(CreateExpenseCategorySchema.parse({ name: 'Agua', parent_id: '' }).parent_id).toBeUndefined();
    expect(CreateExpenseCategorySchema.parse({ name: 'Agua', parent_id: GUID }).parent_id).toBe(GUID);
    expect(CreateExpenseCategorySchema.safeParse({ name: 'Agua', parent_id: 'nope' }).success).toBe(false);
  });
});

describe('category tree', () => {
  const rows = [
    { id: 'b', name: 'Servicios', color: null, parentId: null },
    { id: 'c', name: 'Luz', color: null, parentId: 'b' },
    { id: 'a', name: 'Mantenimiento', color: null, parentId: null },
    { id: 'd', name: 'Agua', color: null, parentId: 'b' },
  ];

  it('groups children under sorted parents', () => {
    const tree = buildCategoryTree(rows);
    expect(tree.map((node) => node.name)).toEqual(['Mantenimiento', 'Servicios']);
    expect(tree[1].children.map((child) => child.name)).toEqual(['Agua', 'Luz']);
  });

  it('builds select labels with the parent prefix', () => {
    expect(categoryOptions(rows).map((option) => option.label)).toEqual([
      'Mantenimiento', 'Servicios', 'Servicios › Agua', 'Servicios › Luz',
    ]);
  });
});

describe('totalsByKind', () => {
  it('sums amounts per kind', () => {
    expect(totalsByKind([
      { amount: '10.50', kind: 'ordinary' },
      { amount: '100', kind: 'extraordinary' },
      { amount: '4.50', kind: 'ordinary' },
    ])).toEqual({ ordinary: 15, extraordinary: 100 });
  });
});

describe('expense filters', () => {
  const today = new Date('2026-11-23T12:00:00Z');

  it('falls back to the current month for missing or invalid input', () => {
    expect(resolveMonth('2026-02', today)).toBe('2026-02');
    expect(resolveMonth('2026-13', today)).toBe('2026-11');
    expect(resolveMonth(undefined, today)).toBe('2026-11');
  });

  it('accepts only known kinds', () => {
    expect(resolveKind('extraordinary')).toBe('extraordinary');
    expect(resolveKind('other')).toBeUndefined();
  });
});
