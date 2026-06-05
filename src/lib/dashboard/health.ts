/**
 * src/lib/dashboard/health.ts
 *
 * Server-side entity health check for the admin dashboard.
 * Counts rows in the four core entity tables for the current org.
 * Each entity is checked independently so one failure cannot block others.
 * Raw DB error messages are never returned — only generic Spanish strings.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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

/**
 * Returns health status for each of the four core entity tables.
 * A status is "ok" when count > 0 and no error occurred.
 * The caller decides whether to surface the banner.
 *
 * Security: raw Supabase error messages are not forwarded to the client.
 * Only generic Spanish strings are returned in the `error` field.
 */
export async function checkEntityHealth(
  supabase: SupabaseClient,
  orgId: string,
): Promise<EntityHealth[]> {
  const entities: EntityName[] = ['tenants', 'properties', 'payments', 'contracts'];

  const results = await Promise.all(
    entities.map(async (entity): Promise<EntityHealth> => {
      try {
        const { count, error } = await supabase
          .from(entity)
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId);

        if (error) {
          return {
            entity,
            count: 0,
            error: `No se pudo verificar ${ENTITY_LABEL[entity]}.`,
          };
        }

        return { entity, count: count ?? 0, error: null };
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
