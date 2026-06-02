import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { CreateTenantForm } from './CreateTenantForm';

export const metadata: Metadata = { title: 'Tenants' };

export default async function TenantsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: tenants } = await supabase
    .from('tenants')
    .select('*, units(label, properties(name))')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });

  const list = tenants ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenants</h1>
          <p className="text-sm text-slate-500 mt-1">{list.length} total</p>
        </div>
        <CreateTenantForm />
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
            }
            title="No tenants yet"
            description="Add your first tenant to start managing contracts and payments."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Tenants list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Unit</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Portal</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((tenant) => {
                const unit = tenant.units as { label: string; properties: { name: string } | null } | null;
                return (
                  <tr key={tenant.id} className="hover:bg-slate-50 transition-colors cursor-pointer relative">
                    <td className="px-5 py-4">
                      {/* Stretched link covers the entire row */}
                      <Link
                        href={`/dashboard/tenants/${tenant.id}`}
                        className="absolute inset-0 z-10"
                        aria-label={`View ${tenant.full_name} profile`}
                      />
                      <div className="flex items-center gap-3 relative z-20">
                        <Avatar name={tenant.full_name} size="sm" />
                        <span className="font-medium text-slate-900 text-sm">{tenant.full_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {tenant.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : <span className="text-slate-300">Unassigned</span>}
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <Badge variant={tenant.profile_id ? 'success' : 'default'}>
                        {tenant.profile_id ? 'Active' : 'No login'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right relative z-20">
                      <Link href={`/dashboard/tenants/${tenant.id}`}>
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
