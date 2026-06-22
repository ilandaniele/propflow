/**
 * src/lib/dashboard/health.ts
 *
 * Server-side entity health check for the admin dashboard.
 * Counts rows in the four core entity tables for the current org.
 * Each entity is checked independently so one failure cannot block others.
 * Raw DB error messages are never returned — only generic Spanish strings.
 *
 * Migrated from Supabase client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { tenants, properties, payments, contracts } from '@/lib/db/schema';
import { eq, and, count } from 'drizzle-orm';

export type EntityName = 'tenants' | 'properties' | 'payments' | 'contracts';

export type EntityHealth = {
  entity: EntityName;
  count: number;
  error: string | null;
};

const ENTITY_LABEL: Record<EntityName, string> = {
  tenants: 'Inquilinos',
  properties: 'Propiedades',
  payments: 'Pagos',
  contracts: 'Contratos',
};

const ENTITY_TABLE = {
  tenants,
  properties,
  payments,
  contracts,
} as const;

/**
 * Returns health status for each of the four core entity tables.
 * A status is "ok" when count > 0 and no error occurred.
 * The caller decides whether to surface the banner.
 *
 * Security: raw DB error messages are not forwarded to the client.
 * Only generic Spanish strings are returned in the `error` field.
 */
export async function checkEntityHealth(
  orgId: string,
): Promise<EntityHealth[]> {
  const entities: EntityName[] = ['tenants', 'properties', 'payments', 'contracts'];

  const results = await Promise.all(
    entities.map(async (entity): Promise<EntityHealth> => {
      try {
        const table = ENTITY_TABLE[entity];
        const rows = await db
          .select({ n: count() })
          .from(table)
          .where(eq((table as typeof tenants).orgId, orgId));

        return { entity, count: Number(rows[0]?.n ?? 0), error: null };
      } catch {
        return {
          entity,
          count: 0,
          error: `No se pudo verificar ${ENTITY_LABEL[entity]}.`,
        };
      }
    }),
  );

  return results;
}

/**
 * Returns the Spanish display label for an entity name.
 */
export function entityLabel(entity: EntityName): string {
  return ENTITY_LABEL[entity];
}
