import { describe, it, expect } from 'vitest';
import { slaState, SLA_HOURS } from '@/lib/incidents/sla';

const created = new Date('2026-11-01T00:00:00Z');
const hours = (h: number) => new Date(created.getTime() + h * 3_600_000);

describe('slaState', () => {
  it('sets the deadline from the priority', () => {
    expect(slaState({ priority: 'urgent', status: 'pending', createdAt: created, resolvedAt: null }, hours(1)).deadline).toEqual(hours(24));
    expect(slaState({ priority: 'low', status: 'pending', createdAt: created, resolvedAt: null }, hours(1)).deadline).toEqual(hours(SLA_HOURS.low));
  });

  it('falls back to medium for unknown priorities', () => {
    expect(slaState({ priority: 'weird', status: 'pending', createdAt: created, resolvedAt: null }, hours(1)).deadline).toEqual(hours(168));
  });

  it('flags open incidents past the deadline', () => {
    expect(slaState({ priority: 'urgent', status: 'in_progress', createdAt: created, resolvedAt: null }, hours(25))).toMatchObject({ breached: true, done: false });
    expect(slaState({ priority: 'urgent', status: 'pending', createdAt: created, resolvedAt: null }, hours(23))).toMatchObject({ breached: false, done: false });
  });

  it('judges solved incidents by their resolution time', () => {
    expect(slaState({ priority: 'urgent', status: 'solved', createdAt: created, resolvedAt: hours(10) }, hours(500))).toMatchObject({ breached: false, done: true });
    expect(slaState({ priority: 'urgent', status: 'solved', createdAt: created, resolvedAt: hours(30) }, hours(500))).toMatchObject({ breached: true, done: true });
  });
});
