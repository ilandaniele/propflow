'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProperty } from '@/app/actions/properties';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

const INITIAL_STATE: ActionResult = {};

/**
 * Client island for adding a property from the server-rendered properties page.
 * Manages its own open/closed state. Uses useActionState + Server Action.
 */
export function AddPropertyDialog() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    async (prev, formData) => {
      const result = await createProperty(prev, formData);
      if (!result.error) {
        setShowForm(false);
        router.refresh(); // re-fetch RSC so new property appears in the list
      }
      return result;
    },
    INITIAL_STATE
  );

  if (!showForm) {
    return (
      <Button size="sm" onClick={() => setShowForm(true)}>
        Add Property
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <Card className="w-full max-w-md">
        <h2 className="text-base font-semibold text-slate-900 mb-4">New Property</h2>
        <form action={action} className="space-y-4">
          <Input label="Property Name" name="name" required placeholder="e.g. Oak Street Complex" />
          <Input label="Address" name="address" placeholder="123 Oak Street" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" name="city" placeholder="New York" />
            <Input label="Country" name="country" placeholder="US" />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-red-600">
              {state.error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending}>
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowForm(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
