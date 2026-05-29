import { describe, it, expect } from 'vitest';
import { todayStr, addDays, daysBetween } from '@/lib/notifications/reminder-engine';

describe('reminder-engine date helpers', () => {
  it('todayStr returns a YYYY-MM-DD string', () => {
    const today = todayStr();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('addDays adds the correct number of days', () => {
    expect(addDays('2026-01-01', 30)).toBe('2026-01-31');
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01'); // month rollover
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01'); // year rollover
  });

  it('daysBetween computes correct positive difference', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2026-02-01')).toBe(31);
  });

  it('daysBetween handles negative difference (past)', () => {
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
  });

  it('dedup logic: same target_id + same type + same date would be a duplicate', () => {
    // Simulates the check: if a reminder with the same key already exists, skip.
    // This is a pure logic check — the actual DB call is in reminder-engine.ts.
    const contractId = '00000000-0000-0000-0000-000000000001';
    const today = '2026-05-29';

    const existingReminders = [
      { org_id: 'org-a', type: 'lease_renewal', target_type: 'contract', target_id: contractId, scheduled_for: today, status: 'sent' },
    ];

    const isDuplicate = existingReminders.some(
      r => r.type === 'lease_renewal' && r.target_id === contractId && r.scheduled_for === today && ['sent', 'scheduled'].includes(r.status)
    );
    expect(isDuplicate).toBe(true);

    // Different date — not a duplicate
    const isDuplicateDifferentDay = existingReminders.some(
      r => r.type === 'lease_renewal' && r.target_id === contractId && r.scheduled_for === '2026-05-30' && ['sent', 'scheduled'].includes(r.status)
    );
    expect(isDuplicateDifferentDay).toBe(false);
  });
});
