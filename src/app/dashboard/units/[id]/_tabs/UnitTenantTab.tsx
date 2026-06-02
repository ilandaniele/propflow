/**
 * Unit Tenant tab — full tenant info card with link to tenant detail.
 * Server Component (no 'use client').
 */

import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

interface Tenant {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  profile_id?: string | null;
}

interface Contract {
  start_date: string;
  monthly_rent: number;
  status: string;
}

interface UnitTenantTabProps {
  tenant: Tenant | null;
  activeContract: Contract | null;
}

export function UnitTenantTab({ tenant, activeContract }: UnitTenantTabProps) {
  if (!tenant) {
    return (
      <div className="p-4">
        <Card>
          <EmptyState
            title="No tenant assigned"
            description="This unit is currently vacant. Assign a tenant to manage payments and incidents."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Tenant info card */}
      <Card>
        <CardHeader>
          <CardTitle>Tenant Information</CardTitle>
          <Badge variant={tenant.profile_id ? 'success' : 'default'}>
            {tenant.profile_id ? 'Portal Active' : 'No Portal Login'}
          </Badge>
        </CardHeader>

        <div className="flex items-start gap-4">
          <Avatar name={tenant.full_name} size="lg" />
          <div className="flex-1 space-y-2">
            <p className="font-semibold text-slate-900 text-base">{tenant.full_name}</p>
            <dl className="space-y-1 text-sm">
              {tenant.email && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-16 shrink-0">Email</dt>
                  <dd className="text-slate-900">{tenant.email}</dd>
                </div>
              )}
              {tenant.phone && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-16 shrink-0">Phone</dt>
                  <dd className="text-slate-900">{tenant.phone}</dd>
                </div>
              )}
              {activeContract && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-16 shrink-0">Move-in</dt>
                  <dd className="text-slate-900">{activeContract.start_date}</dd>
                </div>
              )}
              {activeContract && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-16 shrink-0">Rent</dt>
                  <dd className="font-medium text-slate-900">
                    ${Number(activeContract.monthly_rent).toLocaleString()}/mo
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100">
          <Link href={`/dashboard/tenants/${tenant.id}`}>
            <Button variant="secondary" size="sm">
              View full tenant profile →
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
