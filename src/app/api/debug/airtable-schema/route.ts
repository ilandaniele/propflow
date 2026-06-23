/**
 * GET /api/debug/airtable-schema
 * Temporary diagnostic — fetches all tables + fields from configured Airtable base.
 * DELETE after schema analysis is complete.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getAirtableClient } from '@/lib/airtable/client';

export async function GET(): Promise<NextResponse> {
  try { await requireAdmin(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseId = process.env['AIRTABLE_BASE_ID'];
  const pat = process.env['AIRTABLE_PAT'];
  if (!baseId || !pat) {
    return NextResponse.json({ error: 'Airtable not configured' }, { status: 503 });
  }

  try {
    const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json() as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: unknown }> }> };
    const tables = (data.tables || []).map(t => ({
      id: t.id,
      name: t.name,
      fieldCount: t.fields.length,
      fields: t.fields.map(f => ({ id: f.id, name: f.name, type: f.type })),
    }));
    return NextResponse.json({ baseId, tableCount: tables.length, tables });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
