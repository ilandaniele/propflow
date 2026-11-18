import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

const ESCAPE_CLAUSE = sql.raw("ESCAPE '\\'");

/** Escapes LIKE wildcards so user input matches literally (pair with `ESCAPE '\'`). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Case-insensitive substring match. SQLite LIKE folds case for ASCII letters only. */
export function containsLike(column: SQLWrapper, term: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(term)}%`} ${ESCAPE_CLAUSE}`;
}

/** Case-insensitive equality (ASCII), without LIKE wildcards. */
export function equalsIgnoreCase(column: SQLWrapper, value: string): SQL {
  return sql`lower(${column}) = lower(${value})`;
}
