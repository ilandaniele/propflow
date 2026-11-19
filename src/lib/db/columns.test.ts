import { describe, expect, it } from 'vitest';
import { getTableConfig, sqliteTable } from 'drizzle-orm/sqlite-core';
import { bool, createdAt, dateStr, fk, id, json, money, ts, updatedAt } from './schema/columns';

const t = sqliteTable('things', {
  id: id(),
  ownerId: fk('owner_id').notNull(),
  seenAt: ts('seen_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  meta: json<{ a: number }>('meta'),
  amount: money('amount'),
  day: dateStr('day'),
  active: bool('active'),
});

const cols = Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, c]));

describe('column helpers', () => {
  it('produces the expected column names and SQL types', () => {
    const types = Object.fromEntries(Object.entries(cols).map(([n, c]) => [n, c.getSQLType()]));
    expect(types).toEqual({
      id: 'text',
      owner_id: 'text',
      seen_at: 'integer',
      created_at: 'integer',
      updated_at: 'integer',
      meta: 'text',
      amount: 'text',
      day: 'text',
      active: 'integer',
    });
  });

  it('id is a primary key defaulting to a uuid', () => {
    expect(cols.id.primary).toBe(true);
    expect(cols.id.defaultFn?.()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('createdAt/updatedAt are not null and default to a Date', () => {
    expect(cols.created_at.notNull).toBe(true);
    expect(cols.created_at.defaultFn?.()).toBeInstanceOf(Date);
    expect(cols.updated_at.notNull).toBe(true);
    expect(cols.updated_at.defaultFn?.()).toBeInstanceOf(Date);
    expect(cols.updated_at.onUpdateFn?.()).toBeInstanceOf(Date);
  });

  it('maps timestamps, booleans, json and money between JS and driver values', () => {
    const d = new Date(1_700_000_000_123);
    expect(cols.seen_at.mapToDriverValue(d)).toBe(1_700_000_000_123);
    expect(cols.seen_at.mapFromDriverValue(1_700_000_000_123)).toEqual(d);
    expect(cols.active.mapToDriverValue(true)).toBe(1);
    expect(cols.active.mapFromDriverValue(0)).toBe(false);
    expect(cols.meta.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
    expect(cols.meta.mapFromDriverValue('{"a":1}')).toEqual({ a: 1 });
    expect(cols.amount.mapFromDriverValue('1500.50')).toBe('1500.50');
  });

  it('infers string for money and dateStr', () => {
    const row: typeof t.$inferSelect = {} as typeof t.$inferSelect;
    const amount: string | null = row.amount;
    const day: string | null = row.day;
    const active: boolean | null = row.active;
    const created: Date = row.createdAt;
    expect([amount, day, active, created]).toBeDefined();
  });
});
