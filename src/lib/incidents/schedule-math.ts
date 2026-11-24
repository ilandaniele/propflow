export type ScheduleState = 'overdue' | 'scheduled' | null;

export function scheduleState(status: string, estimatedOn: string | null, today: string): ScheduleState {
  if (status === 'solved' || !estimatedOn) return null;
  return estimatedOn < today ? 'overdue' : 'scheduled';
}
