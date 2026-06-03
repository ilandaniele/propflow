'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea, Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';
import type { IncidentCategory, IncidentPriority } from '@/types';

const CATEGORIES: Array<{ value: IncidentCategory; labelEs: string; labelEn: string }> = [
  { value: 'plumbing', labelEs: 'Plomería', labelEn: 'Plumbing' },
  { value: 'electrical', labelEs: 'Eléctrico', labelEn: 'Electrical' },
  { value: 'appliance', labelEs: 'Electrodoméstico', labelEn: 'Appliance' },
  { value: 'structural', labelEs: 'Estructural', labelEn: 'Structural' },
  { value: 'cleaning', labelEs: 'Limpieza', labelEn: 'Cleaning' },
  { value: 'material_damage', labelEs: 'Daño material', labelEn: 'Material damage' },
  { value: 'malfunction', labelEs: 'Mal funcionamiento', labelEn: 'Malfunction' },
  { value: 'other', labelEs: 'Otros', labelEn: 'Other' },
];

const PRIORITIES: Array<{ value: IncidentPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

interface IncidentFormProps {
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Display category labels in Spanish when true (default: false = English) */
  spanish?: boolean;
  /** Label for the submit button */
  submitLabel?: string;
  /** Label shown while submitting */
  submittingLabel?: string;
}

function SubmitButton({ submitLabel, submittingLabel }: { submitLabel: string; submittingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? submittingLabel : submitLabel}
    </Button>
  );
}

/**
 * Reusable incident creation form.
 * Supports all 8 incident categories (including material_damage and malfunction).
 * Used by both the portal new-incident page and the admin dashboard incident creation.
 */
export function IncidentForm({
  action,
  spanish = false,
  submitLabel = 'Submit Incident',
  submittingLabel = 'Submitting...',
}: IncidentFormProps) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-4">
      <Input
        label={spanish ? 'Título' : 'Title'}
        name="title"
        required
        placeholder={spanish ? 'ej. Grifo con fuga en el baño' : 'e.g. Leaking faucet in bathroom'}
      />

      <div className="grid grid-cols-2 gap-3">
        <Select
          label={spanish ? 'Categoría' : 'Category'}
          name="category"
          required
          defaultValue="other"
        >
          {CATEGORIES.map(({ value, labelEs, labelEn }) => (
            <option key={value} value={value}>
              {spanish ? labelEs : labelEn}
            </option>
          ))}
        </Select>

        <Select
          label={spanish ? 'Prioridad' : 'Priority'}
          name="priority"
          defaultValue="medium"
        >
          {PRIORITIES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Textarea
        label={spanish ? 'Descripción' : 'Description'}
        name="description"
        required
        rows={5}
        placeholder={
          spanish
            ? 'Describe el problema con detalle — qué pasó, cuándo lo notaste, qué tan grave es...'
            : 'Describe the issue in detail — what happened, when you noticed it, how severe it is...'
        }
      />

      <div>
        <label htmlFor="photo" className="block text-sm font-medium text-slate-700 mb-1">
          {spanish ? 'Foto (opcional — máx. 5 MB, PNG/JPEG/WebP)' : 'Photo (optional — max 5 MB, PNG/JPEG/WebP)'}
        </label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
        />
      </div>

      {state.error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error.message}
        </div>
      )}

      <SubmitButton submitLabel={submitLabel} submittingLabel={submittingLabel} />
    </form>
  );
}
