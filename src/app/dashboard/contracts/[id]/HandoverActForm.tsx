'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import { createHandoverAct } from '@/app/actions/handover';
import { HANDOVER_KINDS, INVENTORY_CONDITIONS, type HandoverItem, type InventoryCondition } from '@/lib/contracts/handover-types';
import type { InventoryItemRow } from '@/lib/contracts/handover';
import type { ActionResult } from '@/lib/errors';

function toHandoverItems(items: InventoryItemRow[]): HandoverItem[] {
  return items.map(({ name, quantity, condition, notes }) => ({ name, quantity, condition, notes }));
}

export function HandoverActForm({ contractId, inventory }: { contractId: string; inventory: InventoryItemRow[] }) {
  const t = useTranslations('handover');
  const [items, setItems] = useState(() => toHandoverItems(inventory));
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    (_prev, formData) => createHandoverAct({}, formData),
    null,
  );

  if (inventory.length === 0) return <p className="text-sm text-slate-500">{t('act.needsInventory')}</p>;

  function update(index: number, patch: Partial<HandoverItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="contract_id" value={contractId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <Select name="kind" label={t('act.kind')} defaultValue="check_in">
        {HANDOVER_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}
      </Select>
      <div className="divide-y divide-slate-100">
        {items.map((item, index) => (
          <div key={index} className="grid gap-2 py-2 sm:grid-cols-[2fr_140px_2fr] sm:items-center">
            <span className="font-medium text-slate-900">{item.name} <span className="text-slate-500">× {item.quantity}</span></span>
            <select
              aria-label={`${t('inventory.condition')} ${item.name}`}
              value={item.condition}
              onChange={(e) => update(index, { condition: e.target.value as InventoryCondition })}
              className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              {INVENTORY_CONDITIONS.map((condition) => <option key={condition} value={condition}>{t(`conditions.${condition}`)}</option>)}
            </select>
            <input
              aria-label={`${t('inventory.notes')} ${item.name}`}
              value={item.notes ?? ''}
              maxLength={500}
              onChange={(e) => update(index, { notes: e.target.value || null })}
              placeholder={t('inventory.notes')}
              className="border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
        ))}
      </div>
      <Textarea name="notes" label={t('act.notes')} maxLength={2000} />
      <Button type="submit" disabled={pending}>{pending ? t('act.creating') : t('act.create')}</Button>
      {state?.error && <p role="alert" className="text-red-600">{t('act.error')}</p>}
      {state?.data && <p role="status" className="text-green-700">{t('act.created')}</p>}
    </form>
  );
}
