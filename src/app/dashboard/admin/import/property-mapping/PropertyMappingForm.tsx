'use client';

/**
 * PropertyMappingForm — client form to add a new property mapping.
 * Calls savePropertyMapping Server Action.
 */

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { savePropertyMapping } from '@/app/actions/mappings';
import type { ActionResult } from '@/lib/errors';
import type { PropertyMapping } from '@/app/actions/mappings';

interface InternalProperty {
  id: string;
  name: string;
}

interface Props {
  properties: InternalProperty[];
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
    >
      {pending ? 'Guardando...' : 'Guardar mapeo'}
    </button>
  );
}

type State = ActionResult<PropertyMapping> | null;

export function PropertyMappingForm({ properties }: Props) {
  const [state, formAction] = useActionState<State, FormData>(
    savePropertyMapping as (prev: State, formData: FormData) => Promise<State>,
    null
  );

  const isSuccess = state && !state.error && state.data;

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="externalName" className="block text-xs font-medium text-slate-600 mb-1">
            Nombre externo (en CSV)
          </label>
          <input
            id="externalName"
            name="externalName"
            type="text"
            required
            placeholder="Ej: Casa Palermo A"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor="internalPropertyId" className="block text-xs font-medium text-slate-600 mb-1">
            Propiedad interna
          </label>
          <select
            id="internalPropertyId"
            name="internalPropertyId"
            required
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          >
            <option value="">Seleccionar propiedad…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {isSuccess && (
          <span className="text-sm text-green-600" role="status">Mapeo guardado correctamente</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600" role="alert">{state.error.message}</span>
        )}
      </div>
    </form>
  );
}
