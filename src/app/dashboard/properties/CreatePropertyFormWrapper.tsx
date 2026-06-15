'use client';

import { useActionState, useState } from 'react';
import { createProperty } from '@/app/actions/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export function CreatePropertyFormWrapper() {
  const [showForm, setShowForm] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createProperty, {});

  return (
    <>
      <Button onClick={() => setShowForm(true)} size="sm">Add Property</Button>
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Card className="w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-slate-900 mb-4">New Property</h2>
            <form action={action} className="space-y-4">
              <Input label="Property Name" name="name" required placeholder="e.g. Oak Street Complex" />
              <Input label="Address" name="address" placeholder="123 Oak Street" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="City" name="city" placeholder="New York" />
                <Input label="Country" name="country" placeholder="US" />
              </div>
              {state.error && (
                <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm">Create</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
