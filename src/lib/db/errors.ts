function* chain(err: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let cur = err;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    cur = typeof cur === 'object' ? (cur as { cause?: unknown }).cause : undefined;
  }
}

function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'message' in e) return String(e.message);
  return '';
}

function codeOf(e: unknown): unknown {
  return typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
}

/** True if err (or any cause) is a UNIQUE violation, optionally on a given index/column. */
export function isUniqueViolation(err: unknown, indexOrColumn?: string): boolean {
  for (const e of chain(err)) {
    const msg = messageOf(e);
    const hit = msg.includes('UNIQUE constraint failed') || codeOf(e) === '23505';
    if (hit && (!indexOrColumn || msg.includes(indexOrColumn) || hasPgConstraint(e, indexOrColumn))) {
      return true;
    }
  }
  return false;
}

function hasPgConstraint(e: unknown, name: string): boolean {
  return typeof e === 'object' && e !== null && 'constraint' in e && e.constraint === name;
}

/** True if err (or any cause) message contains marker, e.g. a trigger RAISE name like 'visit_overlap'. */
export function isConstraintError(err: unknown, marker: string): boolean {
  for (const e of chain(err)) {
    if (messageOf(e).includes(marker)) return true;
  }
  return false;
}
