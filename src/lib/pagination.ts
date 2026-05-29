/**
 * Cursor (keyset) pagination utility — IC-C3
 *
 * Cursor is encoded as base64(JSON({created_at, id})) for tamper-resistance.
 * Sort: created_at DESC, id DESC (consistent tiebreaker).
 * Page size: ≤ 50, default 25.
 *
 * The sort/filter fields accepted by page consumers MUST be an allowlist enum —
 * never accept a raw client-supplied column name. Allowlists are defined per table.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export interface Cursor {
  created_at: string;
  id: string;
}

export interface PaginationParams {
  cursor?: string | null;
  limit?: number;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Encode a cursor from row fields */
export function encodeCursor(created_at: string, id: string): string {
  return Buffer.from(JSON.stringify({ created_at, id })).toString('base64');
}

/** Decode a cursor — returns null if invalid (fail-safe, never throws to client) */
export function decodeCursor(cursor: string): Cursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'created_at' in parsed &&
      'id' in parsed &&
      typeof (parsed as Record<string, unknown>).created_at === 'string' &&
      typeof (parsed as Record<string, unknown>).id === 'string'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** Clamp page size to MAX_PAGE_SIZE */
export function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * Build a paginated result from a list of rows.
 * Rows must be sorted (created_at DESC, id DESC) and fetched with limit+1
 * so we can detect if there is a next page.
 *
 * @param rows  The raw rows (limit+1 count)
 * @param limit The requested limit (already clamped)
 */
export function buildPageResult<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number
): PageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;
  return { items, nextCursor, hasMore };
}
