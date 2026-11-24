import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { handoverActs, signatureRequests, unitInventoryItems } from '@/lib/db/schema';
import type { HandoverItem, HandoverKind, InventoryCondition } from './handover-types';
import type { ContractHeader } from './contract-header';
import type { OrgSignature } from './org-signature';

export type InventoryItemRow = { id: string; name: string; quantity: number; condition: InventoryCondition; notes: string | null };

export type HandoverActRow = {
  id: string;
  kind: HandoverKind;
  status: string;
  itemCount: number;
  hasDocument: boolean;
  createdAt: string;
  signedAt: string | null;
  signedRequestId: string | null;
};

export type HandoverActSource = {
  kind: HandoverKind;
  items: HandoverItem[];
  notes: string | null;
  createdAt: string;
  contract: ContractHeader;
  landlord: OrgSignature | null;
};

export function handoverDocumentPath(orgId: string, contractId: string, actId: string): string {
  return `${orgId}/${contractId}/handover-${actId}.pdf`;
}

export function handoverSignaturePath(orgId: string, contractId: string, actId: string): string {
  return `${orgId}/${contractId}/handover-${actId}-signature.png`;
}

export async function listUnitInventory(orgId: string, unitId: string): Promise<InventoryItemRow[]> {
  const rows = await db
    .select({
      id:        unitInventoryItems.id,
      name:      unitInventoryItems.name,
      quantity:  unitInventoryItems.quantity,
      condition: unitInventoryItems.condition,
      notes:     unitInventoryItems.notes,
    })
    .from(unitInventoryItems)
    .where(and(eq(unitInventoryItems.orgId, orgId), eq(unitInventoryItems.unitId, unitId)))
    .orderBy(asc(unitInventoryItems.name))
    .limit(500);
  return rows.map((row) => ({ ...row, condition: row.condition as InventoryCondition }));
}

export async function listHandoverActs(orgId: string, contractId: string): Promise<HandoverActRow[]> {
  const rows = await db
    .select({
      id:              handoverActs.id,
      kind:            handoverActs.kind,
      status:          handoverActs.status,
      items:           handoverActs.items,
      documentPath:    handoverActs.documentPath,
      createdAt:       handoverActs.createdAt,
      signedAt:        handoverActs.signedAt,
      signedRequestId: signatureRequests.id,
    })
    .from(handoverActs)
    .leftJoin(
      signatureRequests,
      and(
        eq(signatureRequests.handoverActId, handoverActs.id),
        eq(signatureRequests.orgId, orgId),
        eq(signatureRequests.status, 'signed'),
      ),
    )
    .where(and(eq(handoverActs.orgId, orgId), eq(handoverActs.contractId, contractId)))
    .orderBy(desc(handoverActs.createdAt))
    .limit(50);
  return rows.map(({ items, createdAt, signedAt, kind, documentPath, ...row }) => ({
    ...row,
    kind:        kind as HandoverKind,
    itemCount:   items.length,
    hasDocument: documentPath !== null,
    createdAt:   createdAt.toISOString(),
    signedAt:    signedAt?.toISOString() ?? null,
  }));
}

export async function findHandoverAct(orgId: string, actId: string) {
  const [act] = await db
    .select()
    .from(handoverActs)
    .where(and(eq(handoverActs.id, actId), eq(handoverActs.orgId, orgId)))
    .limit(1);
  return act ?? null;
}
