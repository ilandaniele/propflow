import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { orgBranding } from '@/lib/db/schema';

export const ORG_LOGO_ROUTE = '/api/org-branding/logo';

export interface OrgBranding {
  accentColor: string | null;
  logoUrl: string | null;
}

interface BrandingRow {
  logoKey: string | null;
  accentColor: string | null;
  updatedAt: Date;
}

export function toBrandingDto(row: BrandingRow | null | undefined): OrgBranding {
  if (!row) return { accentColor: null, logoUrl: null };
  return {
    accentColor: row.accentColor,
    logoUrl: row.logoKey ? `${ORG_LOGO_ROUTE}?v=${row.updatedAt.getTime()}` : null,
  };
}

export async function getOrgBrandingRow(orgId: string): Promise<BrandingRow | null> {
  const [row] = await db
    .select({ logoKey: orgBranding.logoKey, accentColor: orgBranding.accentColor, updatedAt: orgBranding.updatedAt })
    .from(orgBranding)
    .where(eq(orgBranding.orgId, orgId))
    .limit(1);
  return row ?? null;
}

export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  return toBrandingDto(await getOrgBrandingRow(orgId));
}

export async function saveOrgBranding(
  orgId: string,
  values: { logoKey: string | null; accentColor: string | null },
): Promise<BrandingRow> {
  const updatedAt = new Date();
  const [row] = await db
    .insert(orgBranding)
    .values({ orgId, ...values, updatedAt })
    .onConflictDoUpdate({ target: orgBranding.orgId, set: { ...values, updatedAt } })
    .returning({ logoKey: orgBranding.logoKey, accentColor: orgBranding.accentColor, updatedAt: orgBranding.updatedAt });
  return row;
}
