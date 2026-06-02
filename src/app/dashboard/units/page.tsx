import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { CreateUnitForm } from './CreateUnitForm';

export const metadata: Metadata = { title: 'Units' };

/** Display a toilet_type value as a translated badge. Admin-only column. */
function ToiletTypeBadge({ value, label }: { value: string | null | undefined; label: string }) {
  if (value === 'private' || value === 'shared') {
    return <span>{label}</span>;
  }
  // 'none', null, or unexpected → dash
  return <span className="text-slate-400">{label || '—'}</span>;
}

export default async function UnitsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('units');
  const supabase = await createClient();
  const [unitsRes, propertiesRes] = await Promise.all([
    supabase.from('units').select('*, properties(name)').eq('org_id', ctx.orgId).order('created_at', { ascending: false }),
    supabase.from('properties').select('id, name').eq('org_id', ctx.orgId),
  ]);

  const units = unitsRes.data ?? [];
  const properties = propertiesRes.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Units</h1>
          <p className="text-sm text-slate-500 mt-1">{units.length} total</p>
        </div>
        <CreateUnitForm properties={properties} />
      </div>

      {units.length === 0 ? (
        <Card>
          <EmptyState
            title="No units yet"
            description="Add units to your properties to start assigning tenants."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Units list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Property</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Default Rent</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Baño</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.map((unit) => {
                const property = unit.properties as { name: string } | null;
                return (
                  <tr key={unit.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-900 text-sm">{unit.label}</p>
                      {unit.floor && <p className="text-xs text-slate-400">Floor {unit.floor}</p>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{property?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unit.monthly_rent_default ? `$${unit.monthly_rent_default.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm hidden lg:table-cell">
                      <ToiletTypeBadge
                        value={unit.toilet_type}
                        label={
                          unit.toilet_type === 'private' ? t('toiletType.private')
                          : unit.toilet_type === 'shared' ? t('toiletType.shared')
                          : t('toiletType.none')
                        }
                      />
                    </td>
                    <td className="px-5 py-4"><StatusPill status={unit.status} /></td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/dashboard/units/${unit.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
