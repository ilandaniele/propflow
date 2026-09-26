/**
 * Pure planner for the agent_jobs a booked visit needs — no `db`, no env.
 * bookVisit() inserts the returned rows in the same transaction as the visit
 * (see service.ts).
 */

export const VISIT_JOB_KINDS = {
  reminder24h: 'visit.reminder_24h',
  reminder2h: 'visit.reminder_2h',
  advisorReminder: 'visit.advisor_reminder',
  postCheck: 'visit.post_check',
} as const;

export type VisitJobKind = (typeof VISIT_JOB_KINDS)[keyof typeof VISIT_JOB_KINDS];

export interface VisitJobPayload {
  visitId: string;
  startsAt: string; // snapshot ISO — handlers no-op if the visit's current startsAt has drifted
}

const MS_MIN = 60_000;

export function planVisitJobs(v: { startsAt: Date; endsAt: Date }, now: Date): Array<{ kind: VisitJobKind; runAt: Date }> {
  const jobs: Array<{ kind: VisitJobKind; runAt: Date }> = [];

  const reminder24hAt = new Date(v.startsAt.getTime() - 24 * 60 * MS_MIN);
  if (reminder24hAt.getTime() > now.getTime() + 10 * MS_MIN) {
    jobs.push({ kind: VISIT_JOB_KINDS.reminder24h, runAt: reminder24hAt });
  }

  const reminder2hAt = new Date(v.startsAt.getTime() - 2 * 60 * MS_MIN);
  if (reminder2hAt.getTime() > now.getTime() + 5 * MS_MIN) {
    jobs.push({ kind: VISIT_JOB_KINDS.reminder2h, runAt: reminder2hAt });
  }

  const advisorReminderAt = new Date(v.startsAt.getTime() - 60 * MS_MIN);
  jobs.push({ kind: VISIT_JOB_KINDS.advisorReminder, runAt: advisorReminderAt.getTime() > now.getTime() ? advisorReminderAt : now });

  const postCheckAt = new Date(v.endsAt.getTime() + 2 * 60 * MS_MIN);
  jobs.push({ kind: VISIT_JOB_KINDS.postCheck, runAt: postCheckAt });

  return jobs;
}
