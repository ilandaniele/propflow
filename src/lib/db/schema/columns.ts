import { integer, text } from 'drizzle-orm/sqlite-core';

/** UUID text primary key generated in JS. */
export const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());

/** Foreign key column (UUID as text). */
export const fk = (name: string) => text(name);

/** Timestamp stored as epoch milliseconds, read as Date. */
export const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** created_at, set on insert. */
export const createdAt = () =>
  ts('created_at')
    .notNull()
    .$defaultFn(() => new Date());

/** updated_at, set on insert and on every update. */
export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** JSON stored as text, typed as T. */
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

/** Exact decimal stored as TEXT (not NUMERIC affinity, which coerces to REAL). */
export const money = (name: string) => text(name);

/** Calendar date as 'YYYY-MM-DD' text. */
export const dateStr = (name: string) => text(name);

/** Boolean stored as 0/1 integer. */
export const bool = (name: string) => integer(name, { mode: 'boolean' });
