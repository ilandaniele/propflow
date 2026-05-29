import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { PricingTableForm } from './PricingTableForm';
import type { PricingTable, PricingTier } from '@/types';

export default async function PricingPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: tables } = await supabase
    .from('pricing_tables')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('property_type', { ascending: true });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Pricing Tables (RTABLES)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Define reference rent ranges by property type and market zone. These are suggestions — they do not enforce rent amounts.
        </p>
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>New Pricing Table</CardTitle></CardHeader>
        <PricingTableForm />
      </Card>

      {(tables ?? []).length === 0 ? (
        <EmptyState title="No pricing tables yet" description="Create pricing matrices to guide rent suggestions." />
      ) : (
        <div className="space-y-4">
          {(tables as PricingTable[]).map((table) => {
            const tiers = (table.tiers as PricingTier[]) ?? [];
            return (
              <Card key={table.id} padding="md">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-medium text-slate-900">{table.name}</h3>
                    <p className="text-xs text-slate-500">{table.property_type} · {table.market_zone}</p>
                  </div>
                </div>
                {tiers.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-1 text-slate-500 font-medium">Label</th>
                        <th className="text-right py-1 text-slate-500 font-medium">Bedrooms</th>
                        <th className="text-right py-1 text-slate-500 font-medium">Min</th>
                        <th className="text-right py-1 text-slate-500 font-medium">Max</th>
                        <th className="text-right py-1 text-slate-500 font-medium">Suggested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.map((tier, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1 text-slate-700">{tier.label}</td>
                          <td className="py-1 text-right text-slate-700">{tier.bedrooms}</td>
                          <td className="py-1 text-right text-slate-500">${tier.min_rent}</td>
                          <td className="py-1 text-right text-slate-500">${tier.max_rent}</td>
                          <td className="py-1 text-right font-medium text-slate-900">${tier.suggested_rent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
