export const STAFF_ROLES = ['finance', 'operations', 'viewer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type StaffArea = 'finance' | 'operations';
export type StaffAccess = 'read' | 'write';

const WRITABLE_AREA: Record<StaffRole, StaffArea | null> = {
  finance: 'finance',
  operations: 'operations',
  viewer: null,
};

/** A null staff role means a full admin: every area, read and write. */
export function canAccess(role: StaffRole | null, area: StaffArea, access: StaffAccess): boolean {
  if (role === null) return true;
  if (role === 'viewer') return access === 'read';
  return WRITABLE_AREA[role] === area;
}

export function homePathFor(role: StaffRole | null): string {
  if (role === 'finance') return '/dashboard/finance';
  if (role === 'operations' || role === 'viewer') return '/dashboard/incidents';
  return '/dashboard';
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

const FINANCE_NAV = ['/dashboard/finance', '/dashboard/finance/utilities'];
const OPERATIONS_NAV = ['/dashboard/incidents'];

/** Sidebar links a restricted staff role may see; null means every link. */
export function navHrefsFor(role: StaffRole | null): string[] | null {
  if (role === null) return null;
  if (role === 'finance') return FINANCE_NAV;
  if (role === 'operations') return OPERATIONS_NAV;
  return [...FINANCE_NAV, ...OPERATIONS_NAV];
}
