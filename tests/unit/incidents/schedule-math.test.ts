import { describe, it, expect } from 'vitest';
import { scheduleState } from '@/lib/incidents/schedule-math';

describe('scheduleState', () => {
  const today = '2026-11-22';

  it('flags open requests past their estimated date as overdue', () => {
    expect(scheduleState('pending', '2026-11-21', today)).toBe('overdue');
    expect(scheduleState('in_progress', '2026-01-01', today)).toBe('overdue');
  });

  it('marks open requests due today or later as scheduled', () => {
    expect(scheduleState('pending', today, today)).toBe('scheduled');
    expect(scheduleState('in_progress', '2026-12-01', today)).toBe('scheduled');
  });

  it('ignores solved requests and requests without a date', () => {
    expect(scheduleState('solved', '2026-01-01', today)).toBeNull();
    expect(scheduleState('pending', null, today)).toBeNull();
  });
});
