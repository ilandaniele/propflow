/**
 * Pure tenant-feedback metric helpers. Extracted so the satisfaction math is
 * unit-tested. Callers must pass every feedback row — never a capped set.
 */

/** Average of the non-null scores, to 1 decimal, or null if none present. */
export function averageScore(values: Array<number | null | undefined>): string | null {
  const vals = values.filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

/** Count and integer-% of rows where wouldRecommend === true. */
export function recommendStats(rows: Array<{ wouldRecommend?: boolean | null }>): {
  count: number;
  rate: number;
} {
  const count = rows.filter((r) => r.wouldRecommend === true).length;
  return { count, rate: rows.length > 0 ? Math.round((count / rows.length) * 100) : 0 };
}
