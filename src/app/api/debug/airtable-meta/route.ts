import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';

// Temporary diagnostic endpoint — delete after getting table names
export const dynamic = 'force-dynamic';

export async function GET() {
  // AC6 / W4: requireAdmin guard added (previously unguarded)
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) {
    return NextResponse.json({ error: 'Missing env vars', pat: !!pat, baseId: !!baseId });
  }

  // List all bases the PAT can access
  const basesRes = await fetch('https://api.airtable.com/v0/meta/bases', {
    headers: { Authorization: `Bearer ${pat}` },
  });
  const basesData = await basesRes.json() as { bases?: { id: string; name: string }[] };

  // List tables in the configured base
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  const tablesData = await tablesRes.json() as { tables?: { id: string; name: string; fields: { id: string; name: string; type: string }[] }[]; error?: string };

  // Fetch one sample record from each table to see actual field names used
  const tableIds = ['tblje9jK08l8GiQNz', 'tbl7OAVpSBJdVXA5e', 'tbloQETX5MFLmJGgK', 'tbl5y4eu0CX7nUTrm', 'tblXCoEsI0sItlppF'];
  const samples: Record<string, unknown> = {};
  for (const tid of tableIds) {
    const r = await fetch(`https://api.airtable.com/v0/${baseId}/${tid}?maxRecords=1`, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    const d = await r.json() as { records?: { fields: Record<string, unknown> }[] };
    samples[tid] = Object.keys(d.records?.[0]?.fields ?? {});
  }

  return NextResponse.json({
    configuredBaseId: baseId,
    allBases: (basesData.bases ?? []).map(b => ({ id: b.id, name: b.name })),
    tablesInConfiguredBase: tablesData.tables?.map(t => ({
      id: t.id,
      name: t.name,
      fields: t.fields?.map((f: { id: string; name: string; type: string }) => ({ id: f.id, name: f.name, type: f.type })),
    })) ?? tablesData,
    sampleFieldsForMissingTables: samples,
  });
}
