import { NextResponse } from 'next/server';

// Temporary diagnostic endpoint — delete after getting table names
export const dynamic = 'force-dynamic';

export async function GET() {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) {
    return NextResponse.json({ error: 'Missing env vars', pat: !!pat, baseId: !!baseId });
  }

  const [basesRes, tablesRes] = await Promise.all([
    fetch('https://api.airtable.com/v0/meta/bases', {
      headers: { Authorization: `Bearer ${pat}` },
    }),
    fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: { Authorization: `Bearer ${pat}` },
    }),
  ]);

  const basesData = await basesRes.json() as { bases?: { id: string; name: string }[] };
  const tablesData = await tablesRes.json() as { tables?: { id: string; name: string }[] };

  return NextResponse.json({
    configuredBaseId: baseId,
    allBases: (basesData.bases ?? []).map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })),
    tablesInConfiguredBase: (tablesData.tables ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
    rawTablesResponse: tablesData.tables ? undefined : tablesData,
  });
}
