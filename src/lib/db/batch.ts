import { getTableColumns } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** D1 binds at most 100 parameters per statement. */
const D1_MAX_BOUND_PARAMS = 100;

/** Rows per multi-row INSERT into `table` that stay under D1's bound-parameter limit. */
export function rowsPerInsert(table: SQLiteTable): number {
  return Math.floor(D1_MAX_BOUND_PARAMS / Object.keys(getTableColumns(table)).length);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Narrows a statement list to the non-empty tuple `db.batch` expects; null when there is nothing to run. */
export function asBatch(statements: BatchItem<'sqlite'>[]): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] | null {
  return statements.length > 0 ? (statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]) : null;
}
