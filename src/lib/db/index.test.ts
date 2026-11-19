import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { is, sql } from 'drizzle-orm';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

const ctx = vi.hoisted(() => ({ env: { DB: {} as unknown } }));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(() => ctx),
}));

vi.mock('./schema', () => ({}));

import { db, getDb, __setTestDb, type DB } from './index';

function fakeDb() {
  const real = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    all: vi.fn(async () => [{ n: 1 }]),
    tag: 'fake',
  };
  return real;
}

describe('db proxy', () => {
  afterEach(() => __setTestDb(null));

  it('forwards property access and calls to getDb()', () => {
    const real = fakeDb();
    __setTestDb(real as unknown as DB);
    expect(getDb()).toBe(real);
    expect((db as unknown as { tag: string }).tag).toBe('fake');
    const result = (db as unknown as { select: () => unknown }).select();
    expect(real.select).toHaveBeenCalledTimes(1);
    expect(result).toBe(real);
  });

  it('aliases execute to all and returns rows', async () => {
    const real = fakeDb();
    __setTestDb(real as unknown as DB);
    const query = sql`select 1 as n`;
    const rows = await db.execute(query);
    expect(rows).toEqual([{ n: 1 }]);
    expect(real.all).toHaveBeenCalledWith(query);
  });

  it('is recognised as a SQLite drizzle db without touching the context', async () => {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    vi.mocked(getCloudflareContext).mockClear();
    expect(is(db, BaseSQLiteDatabase)).toBe(true);
    expect(getCloudflareContext).not.toHaveBeenCalled();
  });
});

describe('getDb', () => {
  beforeEach(() => __setTestDb(null));

  it('memoizes one client per D1 binding', () => {
    const bindingA = {};
    const bindingB = {};
    ctx.env.DB = bindingA;
    const first = getDb();
    expect(getDb()).toBe(first);
    ctx.env.DB = bindingB;
    const second = getDb();
    expect(second).not.toBe(first);
    ctx.env.DB = bindingA;
    expect(getDb()).toBe(first);
  });

  it('throws when the DB binding is missing', () => {
    ctx.env.DB = undefined;
    expect(() => getDb()).toThrow('D1 binding "DB"');
  });
});
