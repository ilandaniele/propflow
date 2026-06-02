/**
 * Unit Overview tab — current tenant card, quick stats, balance.
 * Server Component (no 'use client').
 */

import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

interface Tenant {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  profile_id?: string | null;
}

interface Statement {
  total_charges: number;
  total_approved_payments: number;
  balance: number;
  is_overdue: boolean;
}

interface UnitOverviewTabProps {
  tenant: Tenant | null;
  statement: Statement | null;
  pendingPaymentCount: number;
  openIncidentCount: number;
}

export function UnitOverviewTab({
  tenant,
  statement,
  pendingPaymentCount,
  openIncidentCount,
}: UnitOverviewTabProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Current tenant card */}
      <Card>
        <CardHeader><CardTitle>Current Tenant</CardTitle></CardHeader>
        {tenant ? (
          <div className="flex items-center gap-4 flex-wrap">
            <Avatar name={tenant.full_name} size="md" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900">{tenant.full_name}</p>
              {tenant.email && <p className="text-sm text-slate-500">{tenant.email}</p>}
              {tenant.phone && <p className="text-sm text-slate-500">{tenant.phone}</p>}
              <div className="mt-1">
                <Badge variant={tenant.profile_id ? 'success' : 'default'}>
                  {tenant.profile_id ? 'Portal Active' : 'No Portal'}
                </Badge>
              </div>
            </div>
            <Link
              href={`/dashboard/tenants/${tenant.id}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap"
            >
              View Profile →
            </Link>
          </div>
        ) : (
          <EmptyState
            title="No tenant assigned"
            description="This unit is currently vacant."
          />
        )}
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="text-center py-2">
            <div className="text-2xl font-bold text-slate-900">{pendingPaymentCount}</div>
            <div className="text-xs text-slate-500 mt-1">Pending Payments</div>
          </div>
        </Card>
        <Card>
          <div className="text-center py-2">
            <div className="text-2xl font-bold text-slate-900">{openIncidentCount}</div>
            <div className="text-xs text-slate-500 mt-1">Open Incidents</div>
          </div>
        </Card>
      </div>

      {/* Balance card */}
      {statement && (
        <Card>
          <CardHeader><CardTitle>Account Balance</CardTitle></CardHeader>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">Total Charged</dt>
              <dd className="font-semibold text-slate-900">
                ${Number(statement.total_charges).toLocaleString()}
              </dd>
            </div>
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">Total Paid</dt>
              <dd className="font-semibold text-green-600">
                ${Number(statement.total_approved_payments).toLocaleString()}
              </dd>
            </div>
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">Balance</dt>
              <dd className={`font-bold text-base ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {statement.balance < 0 ? '-' : ''}${Math.abs(statement.balance).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
