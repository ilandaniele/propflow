export const INVENTORY_CONDITIONS = ['new', 'good', 'fair', 'poor', 'broken'] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];
export const HANDOVER_KINDS = ['check_in', 'check_out'] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];
export type HandoverItem = { name: string; quantity: number; condition: InventoryCondition; notes: string | null };
