'use client';

/**
 * PhantomRoomForm — inline client form for mapping a phantom room label to a unit.
 * Calls savePhantomRoomMapping Server Action.
 */

import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { savePhantomRoomMapping } from '@/app/actions/mappings';
import type { ActionResult } from '@/lib/errors';
import type { PhantomRoomMapping } from '@/app/actions/mappings';

interface Unit {
  id: string;
  label: string;
  property_name: string | null;
}

interface Props {
  label: string;
  units: Unit[];
}

function SubmitButton({ label }: { label: string }) {
  const t = useTranslations('adminImport.phantomRooms');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
    >
      {pending ? t('saving') : label}
    </button>
  );
}

type State = ActionResult<PhantomRoomMapping> | null;

export function PhantomRoomForm({ label, units }: Props) {
  const t = useTranslations('adminImport.phantomRooms');
  const [resolution, setResolution] = useState<'mapped' | 'ignored'>('mapped');
  const [state, formAction] = useActionState<State, FormData>(
    savePhantomRoomMapping as (prev: State, formData: FormData) => Promise<State>,
    null
  );

  const isDone = state && !state.error && state.data;

  if (isDone && state?.data) {
    const data = state.data;
    return (
      <div className="flex items-center gap-2">
        {data.resolution === 'mapped' ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {t('mapped')}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
            {t('ignored')}
          </span>
        )}
        <span className="text-xs text-slate-400">{t('savedOk')}</span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      {/* Hidden label field */}
      <input type="hidden" name="label" value={label} />

      {/* Resolution toggle */}
      <div className="flex items-center gap-1 border border-slate-200 rounded-md overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => setResolution('mapped')}
          className={`px-2.5 py-1.5 font-medium transition-colors ${
            resolution === 'mapped'
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('mapAction')}
        </button>
        <button
          type="button"
          onClick={() => setResolution('ignored')}
          className={`px-2.5 py-1.5 font-medium transition-colors ${
            resolution === 'ignored'
              ? 'bg-slate-500 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('ignoreAction')}
        </button>
      </div>
      <input type="hidden" name="resolution" value={resolution} />

      {/* Unit selector — only visible when mapping */}
      {resolution === 'mapped' && (
        <select
          name="unitId"
          required
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none min-w-48"
          aria-label={t('selectUnit')}
        >
          <option value="">{t('selectUnit')}</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}{u.property_name ? ` — ${u.property_name}` : ''}
            </option>
          ))}
        </select>
      )}

      {/* When ignoring, still need a unitId (use first unit as placeholder — ignored anyway) */}
      {resolution === 'ignored' && units[0] && (
        <input type="hidden" name="unitId" value={units[0].id} />
      )}

      <SubmitButton label={resolution === 'mapped' ? t('saveMapping') : t('saveIgnore')} />

      {state?.error && (
        <span className="text-xs text-red-600" role="alert">{state.error.message}</span>
      )}
    </form>
  );
}
