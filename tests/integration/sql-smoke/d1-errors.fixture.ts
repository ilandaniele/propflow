/**
 * Real error messages raised by local D1 (workerd, wrangler 4.164) against
 * src/lib/db/migrations-d1. d1-errors.test.ts re-provokes each one on the live
 * harness and fails if the wording drifts.
 *
 * Shape on the wire: drizzle throws DrizzleQueryError("Failed query: ...")
 * whose `cause` is the D1 Error (`D1_ERROR: <sqlite message>`), whose own
 * `cause` is an Error with the bare sqlite message.
 */

export const D1_ERRORS = {
  unique: 'D1_ERROR: UNIQUE constraint failed: agent_configs.org_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
  check: 'D1_ERROR: CHECK constraint failed: crm_leads_status_check: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)',
  foreignKey: 'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
  visitOverlap: 'D1_ERROR: visit_overlap: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
} as const;

export type D1ErrorKind = keyof typeof D1_ERRORS;

/** Rebuilds the drizzle, D1, sqlite cause chain for a captured message. */
export function d1ErrorChain(kind: D1ErrorKind): Error {
  const message = D1_ERRORS[kind];
  const sqlite = new Error(message.replace(/^D1_ERROR: /, ''));
  const d1 = new Error(message, { cause: sqlite });
  return new Error('Failed query: insert into "t" (...) values (?)\nparams: x', { cause: d1 });
}
