import { describe, it, expect } from 'vitest';
import { CRON_JOB_PATHS, jobsDue } from './schedule';

describe('jobsDue', () => {
  it.each([
    ['* * * * *', '2026-11-16T10:05:00Z', ['agent-sweep', 'agent-dispatch']],
    ['* * * * *', '2026-11-16T10:03:00Z', ['agent-dispatch']],
    ['* * * * *', '2026-11-16T10:00:00Z', ['agent-sweep', 'agent-dispatch']],
    ['0 * * * *', '2026-11-16T07:00:00Z', ['weekly-summary']],
    ['0 * * * *', '2026-11-17T07:00:00Z', []],
    ['0 * * * *', '2026-11-17T08:00:00Z', ['reminders']],
    ['0 * * * *', '2026-11-22T09:00:00Z', ['task-reminders']],
    ['0 * * * *', '2026-11-16T12:00:00Z', ['qa-export']],
    ['0 * * * *', '2026-11-17T12:00:00Z', []],
    ['0 * * * *', '2026-11-22T14:00:00Z', ['lead-alerts']],
    ['0 * * * *', '2026-11-16T15:00:00Z', ['voice-reactivation']],
    ['0 * * * *', '2026-11-21T15:00:00Z', ['voice-reactivation']],
    ['0 * * * *', '2026-11-22T15:00:00Z', []],
    ['0 * * * *', '2026-11-16T03:00:00Z', []],
    ['5 4 * * *', '2026-11-16T04:05:00Z', []],
  ])('%s at %s', (cron, iso, expected) => {
    expect(jobsDue(cron, new Date(iso))).toEqual(expected);
  });

  it('maps every job to a POST /api/cron route', () => {
    for (const path of Object.values(CRON_JOB_PATHS)) expect(path).toMatch(/^\/api\/cron\//);
    expect(CRON_JOB_PATHS['agent-sweep']).toBe('/api/cron/agent-dispatch?sweep=1');
  });
});
