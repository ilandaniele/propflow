import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from './limits';

export { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH };
export const SEARCH_LIMIT_PER_KIND = 8;

export const SEARCH_KINDS = ['tenant', 'property', 'unit', 'incident', 'lead'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
}

export function normalizeQuery(raw: string | undefined): string | null {
  const q = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < SEARCH_MIN_LENGTH || q.length > SEARCH_MAX_LENGTH) return null;
  return q;
}

export const LIKE_ESCAPE = '!';

export function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[!%_]/g, (c) => LIKE_ESCAPE + c)}%`;
}

export function hitHref(hit: Pick<SearchHit, 'kind' | 'id'>): string {
  switch (hit.kind) {
    case 'tenant': return `/dashboard/tenants/${hit.id}`;
    case 'unit': return `/dashboard/units/${hit.id}`;
    case 'incident': return `/dashboard/incidents/${hit.id}`;
    case 'lead': return `/dashboard/leads/${hit.id}`;
    case 'property': return '/dashboard/properties';
  }
}

export async function globalSearch(orgId: string, query: string): Promise<SearchHit[]> {
  const p = likePattern(query);
  const n = SEARCH_LIMIT_PER_KIND;
  const matches = (column: string) => sql`${sql.raw(`LOWER(COALESCE(${column}, ''))`)} LIKE ${p} ESCAPE '!'`;

  return db.all<SearchHit>(sql`
    SELECT * FROM (SELECT 'tenant' AS kind, id, full_name AS title, COALESCE(email, phone) AS subtitle FROM tenants
      WHERE org_id = ${orgId} AND (${matches('full_name')} OR ${matches('email')}
        OR ${matches('phone')} OR ${matches('document_number')})
      ORDER BY full_name LIMIT ${n})
    UNION ALL
    SELECT * FROM (SELECT 'property', id, name, address FROM properties
      WHERE org_id = ${orgId} AND (${matches('name')} OR ${matches('address')})
      ORDER BY name LIMIT ${n})
    UNION ALL
    SELECT * FROM (SELECT 'unit', u.id, u.label, p.name FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.org_id = ${orgId} AND ${matches('u.label')}
      ORDER BY u.label LIMIT ${n})
    UNION ALL
    SELECT * FROM (SELECT 'incident', id, title, status FROM incidents
      WHERE org_id = ${orgId} AND (${matches('title')} OR ${matches('description')})
      ORDER BY created_at DESC LIMIT ${n})
    UNION ALL
    SELECT * FROM (SELECT 'lead', id, full_name, COALESCE(phone, email) FROM crm_leads
      WHERE org_id = ${orgId} AND (${matches('full_name')} OR ${matches('email')}
        OR ${matches('phone')})
      ORDER BY full_name LIMIT ${n})
  `);
}

export function groupHits(hits: SearchHit[]): Array<{ kind: SearchKind; hits: SearchHit[] }> {
  return SEARCH_KINDS
    .map((kind) => ({ kind, hits: hits.filter((h) => h.kind === kind) }))
    .filter((g) => g.hits.length > 0);
}
