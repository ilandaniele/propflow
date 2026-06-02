/**
 * Unit Payments tab — payment history table for the unit's current tenant.
 * Server Component (no 'use client').
 */

import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

interface Payment {
  id: string;
  amount: number;
  paid_at: string;
  method: string;
  status: string;
  reference?: string | null;
}

interface UnitPaymentsTabProps {
  payments: Payment[];
}

export function UnitPaymentsTab({ payments }: UnitPaymentsTabProps) {
  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Payment history will appear here once this unit's tenant makes payments."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    ${Number(p.amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(p.paid_at).toLocaleDateString()} · {p.method}
                  </p>
                  {p.reference && (
                    <p className="text-xs text-slate-400">{p.reference}</p>
                  )}
                </div>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
