'use client';

import { useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { HandoverActRow, InventoryItemRow } from '@/lib/contracts/handover';
import { InventoryEditor } from './InventoryEditor';
import { HandoverActForm } from './HandoverActForm';
import { HandoverActList } from './HandoverActList';

interface Props {
  contractId: string;
  unitId: string;
  tenantEmail: string | null;
  inventory: InventoryItemRow[];
  acts: HandoverActRow[];
}

export function HandoverCards({ contractId, unitId, tenantEmail, inventory, acts }: Props) {
  const t = useTranslations('handover');
  return (
    <>
      <Card>
        <CardHeader><CardTitle>{t('inventory.title')}</CardTitle></CardHeader>
        <InventoryEditor unitId={unitId} items={inventory} />
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('act.title')}</CardTitle></CardHeader>
        <div className="space-y-6">
          <HandoverActList acts={acts} tenantEmail={tenantEmail} />
          <div className="border-t border-slate-100 pt-4">
            <HandoverActForm key={inventory.map((item) => item.id).join()} contractId={contractId} inventory={inventory} />
          </div>
        </div>
      </Card>
    </>
  );
}
