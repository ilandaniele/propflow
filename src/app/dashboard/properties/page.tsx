import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { Property } from '@/types';
import { CreatePropertyFormWrapper } from './CreatePropertyFormWrapper';

export const metadata: Metadata = { title: 'Properties' };

export default async function PropertiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const rows = await db.select().from(properties)
    .where(eq(properties.orgId, ctx.orgId))
    .orderBy(desc(properties.createdAt));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Properties</h1>
          <p className="text-sm text-slate-500 mt-1">{rows.length} {rows.length === 1 ? 'property' : 'properties'}</p>
        </div>
        <CreatePropertyFormWrapper />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No properties yet"
            description="Add your first property to start managing units and tenants."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((property) => (
            <Card key={property.id} padding="sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{property.name}</p>
                  <p className="text-sm text-slate-500">
                    {[property.address, property.city, property.country].filter(Boolean).join(', ') || 'No address'}
                  </p>
                </div>
                <a href={`/dashboard/units?property=${property.id}`}>
                  <Button variant="ghost" size="sm">View Units</Button>
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
