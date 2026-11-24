export const ACTIVITY_ACTIONS = [
  'announcement_published',
  'expense_recorded',
  'incident_resolved',
  'cleaning_scheduled',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
