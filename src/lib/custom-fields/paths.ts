import type { CustomFieldEntityType } from './schemas';

const DETAIL_BASE: Record<CustomFieldEntityType, string> = {
  property: '/dashboard/properties',
  unit: '/dashboard/units',
  tenant: '/dashboard/tenants',
  contract: '/dashboard/contracts',
};

export function entityDetailPath(entityType: CustomFieldEntityType, entityId: string): string {
  return `${DETAIL_BASE[entityType]}/${entityId}`;
}
