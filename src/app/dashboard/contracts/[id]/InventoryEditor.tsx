'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { deleteInventoryItem, saveInventoryItem } from '@/app/actions/handover';
import { INVENTORY_CONDITIONS } from '@/lib/contracts/handover-types';
import type { InventoryItemRow } from '@/lib/contracts/handover';
import type { ActionResult } from '@/lib/errors';

export function InventoryEditor({ unitId, items }: { unitId: string; items: InventoryItemRow[] }) {
  const t = useTranslations('handover');
  const [saveState, saveAction, saving] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => saveInventoryItem(prev ?? {}, formData),
    null,
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => deleteInventoryItem(prev ?? {}, formData),
    null,
  );

  return (
    <div className="space-y-4 text-sm">
      {items.length === 0 ? (
        <p className="text-slate-500">{t('inventory.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-slate-900">{item.name}</span>
                <span className="text-slate-500"> · {item.quantity} · {t(`conditions.${item.condition}`)}</span>
                {item.notes && <span className="block text-slate-500">{item.notes}</span>}
              </span>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={deleting}>{t('inventory.delete')}</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {deleteState?.error && <p role="alert" className="text-red-600">{t('inventory.error')}</p>}

      <form action={saveAction} className="grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[2fr_80px_140px_2fr_auto] sm:items-end">
        <input type="hidden" name="unit_id" value={unitId} />
        <Input name="name" label={t('inventory.name')} required maxLength={120} />
        <Input name="quantity" label={t('inventory.quantity')} type="number" min={1} max={999} defaultValue={1} required />
        <Select name="condition" label={t('inventory.condition')} defaultValue="good">
          {INVENTORY_CONDITIONS.map((condition) => <option key={condition} value={condition}>{t(`conditions.${condition}`)}</option>)}
        </Select>
        <Input name="notes" label={t('inventory.notes')} maxLength={500} />
        <Button type="submit" disabled={saving}>{saving ? t('inventory.saving') : t('inventory.add')}</Button>
      </form>
      {saveState?.error && <p role="alert" className="text-red-600">{t('inventory.error')}</p>}
    </div>
  );
}
