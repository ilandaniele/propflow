const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivityRange = { from?: Date; to?: Date };

function parseDay(value: string | undefined): Date | undefined {
  if (!value || !ISO_DATE.test(value)) return undefined;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) ? undefined : day;
}

export function resolveActivityRange(params: { from?: string; to?: string }): ActivityRange {
  const from = parseDay(params.from);
  const toDay = parseDay(params.to);
  return { from, to: toDay ? new Date(toDay.getTime() + DAY_MS) : undefined };
}
