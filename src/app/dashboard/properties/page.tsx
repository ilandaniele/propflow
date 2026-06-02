import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AddPropertyDialog } from './AddPropertyDialog';

export const metadata: Metadata = { title: 'Properties' };

export default async function PropertiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: properties } = await supabase
    .from('properties')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });

  const list = properties ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Properties</h1>
          <p className="text-sm text-slate-500 mt-1">
            {list.length} {list.length === 1 ? 'property' : 'properties'}
          </p>
        </div>
        {/* Client island — keeps the server page fast */}
        <AddPropertyDialog />
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title="No properties yet"
            description="Add your first property to start managing units and tenants."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {list.map((property) => (
            <Card key={property.id} padding="sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{property.name}</p>
                  <p className="text-sm text-slate-500">
                    {[property.address, property.city, property.country].filter(Boolean).join(', ') || 'No address'}
                  </p>
                </div>
                <Link href={`/dashboard/units?property=${property.id}`}>
                  <Button variant="ghost" size="sm">View Units</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
