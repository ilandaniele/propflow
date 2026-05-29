'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createPricingTable } from '@/app/actions/pricing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Create Table'}</Button>;
}

export function PricingTableForm() {
  const [state, action] = useActionState<ActionResult, FormData>(createPricingTable, {});
  const [tiers, setTiers] = useState([{ label: '', bedrooms: 1, min_rent: 0, max_rent: 0, suggested_rent: 0 }]);

  function addTier() {
    setTiers([...tiers, { label: '', bedrooms: 1, min_rent: 0, max_rent: 0, suggested_rent: 0 }]);
  }

  function updateTier(index: number, field: string, value: string | number) {
    const updated = tiers.map((t, i) => i === index ? { ...t, [field]: value } : t);
    setTiers(updated);
  }

  return (
    <form action={(formData) => {
      formData.set('tiers', JSON.stringify(tiers));
      return action(formData);
    }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input label="Table name" name="name" required placeholder="Downtown Apartments 2025" />
        <Input label="Property type" name="property_type" required placeholder="apartment" />
        <Input label="Market zone" name="market_zone" required placeholder="downtown" />
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Rent Tiers</p>
        {tiers.map((tier, i) => (
          <div key={i} className="grid grid-cols-5 gap-2 mb-2 text-xs">
            <input
              value={tier.label}
              onChange={e => updateTier(i, 'label', e.target.value)}
              placeholder="Label"
              className="border border-slate-300 rounded px-2 py-1"
              aria-label={`Tier ${i+1} label`}
            />
            <input type="number" value={tier.bedrooms} onChange={e => updateTier(i, 'bedrooms', Number(e.target.value))} placeholder="Beds" className="border border-slate-300 rounded px-2 py-1" aria-label="Bedrooms" />
            <input type="number" value={tier.min_rent} onChange={e => updateTier(i, 'min_rent', Number(e.target.value))} placeholder="Min $" className="border border-slate-300 rounded px-2 py-1" aria-label="Min rent" />
            <input type="number" value={tier.max_rent} onChange={e => updateTier(i, 'max_rent', Number(e.target.value))} placeholder="Max $" className="border border-slate-300 rounded px-2 py-1" aria-label="Max rent" />
            <input type="number" value={tier.suggested_rent} onChange={e => updateTier(i, 'suggested_rent', Number(e.target.value))} placeholder="Suggested $" className="border border-slate-300 rounded px-2 py-1" aria-label="Suggested rent" />
          </div>
        ))}
        <button type="button" onClick={addTier} className="text-xs text-brand-600 hover:underline mt-1">+ Add tier</button>
      </div>

      <SubmitButton />
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
