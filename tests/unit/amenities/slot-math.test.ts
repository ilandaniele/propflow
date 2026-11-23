import { describe, it, expect } from 'vitest';
import { daySlots, findSlot, shiftDate, slotGrid } from '@/lib/amenities/slot-math';

describe('daySlots', () => {
  it('splits opening hours into whole slots and drops a trailing partial slot', () => {
    expect(daySlots('08:00', '11:30', 60)).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
    ]);
  });

  it('handles slots that cross hour boundaries', () => {
    expect(daySlots('18:30', '20:00', 45)).toEqual([
      { start: '18:30', end: '19:15' },
      { start: '19:15', end: '20:00' },
    ]);
  });

  it('returns no slots when the window is shorter than one slot', () => {
    expect(daySlots('10:00', '10:30', 60)).toEqual([]);
  });
});

describe('findSlot', () => {
  it('only accepts starts that sit on the grid', () => {
    const slots = daySlots('08:00', '10:00', 60);
    expect(findSlot(slots, '09:00')).toEqual({ start: '09:00', end: '10:00' });
    expect(findSlot(slots, '08:30')).toBeUndefined();
  });
});

describe('slotGrid', () => {
  it('attaches each booking to its slot', () => {
    const grid = slotGrid(daySlots('08:00', '10:00', 60), [{ startTime: '09:00', id: 'b1' }]);
    expect(grid.map((slot) => slot.booking?.id ?? null)).toEqual([null, 'b1']);
  });
});

describe('shiftDate', () => {
  it('moves across month and year ends', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
