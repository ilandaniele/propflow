import { describe, it, expect } from 'vitest';
import { planVisitJobs, VISIT_JOB_KINDS } from '@/lib/agent/visits/job-plan';

function kinds(jobs: Array<{ kind: string }>) {
  return jobs.map((j) => j.kind).sort();
}

describe('agent/visits/job-plan', () => {
  it('plans all four jobs for a visit far in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const startsAt = new Date('2026-01-10T00:00:00Z');
    const endsAt = new Date('2026-01-10T00:45:00Z');
    const jobs = planVisitJobs({ startsAt, endsAt }, now);
    expect(kinds(jobs)).toEqual(kinds([
      { kind: VISIT_JOB_KINDS.reminder24h },
      { kind: VISIT_JOB_KINDS.reminder2h },
      { kind: VISIT_JOB_KINDS.advisorReminder },
      { kind: VISIT_JOB_KINDS.postCheck },
    ]));
  });

  it('omits reminder_24h once startsAt-24h is within 10 minutes of now', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const startsAt = new Date('2026-01-11T00:05:00Z'); // startsAt-24h = now+5min < now+10min
    const endsAt = new Date('2026-01-11T00:45:00Z');
    const jobs = planVisitJobs({ startsAt, endsAt }, now);
    expect(jobs.some((j) => j.kind === VISIT_JOB_KINDS.reminder24h)).toBe(false);
  });

  it('omits reminder_2h once startsAt-2h is within 5 minutes of now', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const startsAt = new Date('2026-01-10T02:03:00Z'); // startsAt-2h = now+3min < now+5min
    const endsAt = new Date('2026-01-10T02:45:00Z');
    const jobs = planVisitJobs({ startsAt, endsAt }, now);
    expect(jobs.some((j) => j.kind === VISIT_JOB_KINDS.reminder2h)).toBe(false);
  });

  it('runs advisor_reminder at now if startsAt-60min already passed', () => {
    const now = new Date('2026-01-10T12:00:00Z');
    const startsAt = new Date('2026-01-10T12:30:00Z'); // startsAt-60min is in the past
    const endsAt = new Date('2026-01-10T13:15:00Z');
    const jobs = planVisitJobs({ startsAt, endsAt }, now);
    const advisorJob = jobs.find((j) => j.kind === VISIT_JOB_KINDS.advisorReminder);
    expect(advisorJob?.runAt.getTime()).toBe(now.getTime());
  });

  it('post_check always runs at endsAt + 2h', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const startsAt = new Date('2026-01-10T00:00:00Z');
    const endsAt = new Date('2026-01-10T00:45:00Z');
    const jobs = planVisitJobs({ startsAt, endsAt }, now);
    const postCheck = jobs.find((j) => j.kind === VISIT_JOB_KINDS.postCheck);
    expect(postCheck?.runAt.getTime()).toBe(endsAt.getTime() + 2 * 60 * 60_000);
  });
});
