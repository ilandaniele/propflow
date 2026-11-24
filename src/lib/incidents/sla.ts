const HOUR_MS = 3_600_000;

export const SLA_HOURS: Record<string, number> = {
  urgent: 24,
  high: 72,
  medium: 168,
  low: 336,
};

type SlaInput = { priority: string; status: string; createdAt: Date; resolvedAt: Date | null };

export type SlaState = { deadline: Date; breached: boolean; done: boolean };

export function slaState(incident: SlaInput, now: Date = new Date()): SlaState {
  const hours = SLA_HOURS[incident.priority] ?? SLA_HOURS.medium;
  const deadline = new Date(incident.createdAt.getTime() + hours * HOUR_MS);
  const done = incident.status === 'solved';
  const closedAt = done ? (incident.resolvedAt ?? now) : now;
  return { deadline, breached: closedAt.getTime() > deadline.getTime(), done };
}
