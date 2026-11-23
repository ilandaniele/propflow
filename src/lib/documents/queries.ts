import { and, asc, desc, eq, inArray, isNotNull, lte, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db';
import { contracts, documents, properties, tenants, units } from '@/lib/db/schema';
import { addDays, EXPIRING_SOON_DAYS, type DocumentCategory, type DocumentEntity, type DocumentMime } from './types';

const LIST_LIMIT = 200;
const OPTIONS_LIMIT = 500;

export interface DocumentRow {
  id:              string;
  name:            string;
  category:        DocumentCategory;
  entityType:      DocumentEntity;
  entityLabel:     string | null;
  mimeType:        DocumentMime;
  sizeBytes:       number;
  expiresOn:       string | null;
  visibleToTenant: boolean;
  createdAt:       string;
}

export interface DocumentFilter {
  entity?:   DocumentEntity;
  expiring?: boolean;
}

export interface EntityOption {
  id:    string;
  label: string;
}

export type EntityOptions = Record<DocumentEntity, EntityOption[]>;

export const ENTITY_COLUMNS = {
  tenant:   documents.tenantId,
  contract: documents.contractId,
  property: documents.propertyId,
} as const;

export function documentStoragePath(orgId: string, documentId: string, extension: string): string {
  return `${orgId}/documents/${documentId}.${extension}`;
}

function entityTypeOf(row: { tenantId: string | null; contractId: string | null }): DocumentEntity {
  if (row.tenantId) return 'tenant';
  if (row.contractId) return 'contract';
  return 'property';
}

async function selectDocuments(orgId: string, where: SQL | undefined, orderByExpiry: boolean): Promise<DocumentRow[]> {
  const docTenant = alias(tenants, 'doc_tenant');
  const contractTenant = alias(tenants, 'contract_tenant');

  const rows = await db
    .select({
      id:                 documents.id,
      name:               documents.name,
      category:           documents.category,
      tenantId:           documents.tenantId,
      contractId:         documents.contractId,
      mimeType:           documents.mimeType,
      sizeBytes:          documents.sizeBytes,
      expiresOn:          documents.expiresOn,
      visibleToTenant:    documents.visibleToTenant,
      createdAt:          documents.createdAt,
      tenantName:         docTenant.fullName,
      contractTenantName: contractTenant.fullName,
      propertyName:       properties.name,
    })
    .from(documents)
    .leftJoin(docTenant, and(eq(docTenant.id, documents.tenantId), eq(docTenant.orgId, orgId)))
    .leftJoin(contracts, and(eq(contracts.id, documents.contractId), eq(contracts.orgId, orgId)))
    .leftJoin(contractTenant, and(eq(contractTenant.id, contracts.tenantId), eq(contractTenant.orgId, orgId)))
    .leftJoin(properties, and(eq(properties.id, documents.propertyId), eq(properties.orgId, orgId)))
    .where(and(eq(documents.orgId, orgId), where))
    .orderBy(orderByExpiry ? asc(documents.expiresOn) : desc(documents.createdAt))
    .limit(LIST_LIMIT);

  return rows.map((row) => ({
    id:              row.id,
    name:            row.name,
    category:        row.category as DocumentCategory,
    entityType:      entityTypeOf(row),
    entityLabel:     row.tenantName ?? row.contractTenantName ?? row.propertyName,
    mimeType:        row.mimeType as DocumentMime,
    sizeBytes:       row.sizeBytes,
    expiresOn:       row.expiresOn,
    visibleToTenant: row.visibleToTenant,
    createdAt:       row.createdAt.toISOString(),
  }));
}

export function listOrgDocuments(orgId: string, filter: DocumentFilter, today: string): Promise<DocumentRow[]> {
  const conditions = [
    filter.entity ? isNotNull(ENTITY_COLUMNS[filter.entity]) : undefined,
    filter.expiring ? lte(documents.expiresOn, addDays(today, EXPIRING_SOON_DAYS)) : undefined,
  ];
  return selectDocuments(orgId, and(...conditions), Boolean(filter.expiring));
}

export function listTenantPortalDocuments(orgId: string, tenantId: string): Promise<DocumentRow[]> {
  const tenantContracts = db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.orgId, orgId)));

  return selectDocuments(
    orgId,
    and(
      eq(documents.visibleToTenant, true),
      or(eq(documents.tenantId, tenantId), inArray(documents.contractId, tenantContracts)),
    ),
    false,
  );
}

export async function listEntityOptions(orgId: string): Promise<EntityOptions> {
  const [tenantRows, contractRows, propertyRows] = await Promise.all([
    db
      .select({ id: tenants.id, label: tenants.fullName })
      .from(tenants)
      .where(eq(tenants.orgId, orgId))
      .orderBy(asc(tenants.fullName))
      .limit(OPTIONS_LIMIT),
    db
      .select({ id: contracts.id, tenantName: tenants.fullName, unitLabel: units.label, startDate: contracts.startDate })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
      .where(eq(contracts.orgId, orgId))
      .orderBy(desc(contracts.startDate))
      .limit(OPTIONS_LIMIT),
    db
      .select({ id: properties.id, label: properties.name })
      .from(properties)
      .where(eq(properties.orgId, orgId))
      .orderBy(asc(properties.name))
      .limit(OPTIONS_LIMIT),
  ]);

  return {
    tenant:   tenantRows,
    contract: contractRows.map((row) => ({
      id:    row.id,
      label: [row.tenantName, row.unitLabel, row.startDate].filter(Boolean).join(' · '),
    })),
    property: propertyRows,
  };
}

export async function findOwnedEntity(orgId: string, entity: DocumentEntity, entityId: string): Promise<boolean> {
  const table = { tenant: tenants, contract: contracts, property: properties }[entity];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.orgId, orgId)))
    .limit(1);
  return Boolean(row);
}

export async function findDocument(orgId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function findTenantIdForUser(orgId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, userId), eq(tenants.orgId, orgId)))
    .limit(1);
  return row?.id ?? null;
}

export async function findPortalDocument(orgId: string, tenantId: string, documentId: string) {
  const tenantContracts = db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.orgId, orgId)));

  const [row] = await db
    .select({ storagePath: documents.storagePath })
    .from(documents)
    .where(and(
      eq(documents.id, documentId),
      eq(documents.orgId, orgId),
      eq(documents.visibleToTenant, true),
      or(eq(documents.tenantId, tenantId), inArray(documents.contractId, tenantContracts)),
    ))
    .limit(1);
  return row ?? null;
}
