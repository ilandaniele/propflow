'use client';

/**
 * TenantOnboardingForm — multi-field form for new tenant self-registration.
 *
 * Submits to POST /api/tenant/register. On success, redirects to /portal.
 * On airtable_failed (syncStatus='failed'), shows a partial-success banner
 * and still redirects — the admin can complete the sync later.
 *
 * Fields match tenantRegistrationSchema (see src/lib/schemas/tenantRegistration.ts).
 * Admin-only fields (property, unit, contract, rent, deposit) are intentionally absent.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tenantRegistrationLabels } from '@/lib/schemas/tenantRegistration';

interface FieldErrors {
  [field: string]: string[];
}

type FormStatus = 'idle' | 'loading' | 'success' | 'airtable_failed' | 'error';

export function TenantOnboardingForm() {
  const router = useRouter();
  const [status, setStatus] = useState<FormStatus>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('loading');
    setFieldErrors({});
    setGlobalError(null);
    setSyncWarning(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const payload = {
      first_name:               formData.get('first_name') as string,
      last_name:                formData.get('last_name') as string,
      email:                    formData.get('email') as string,
      phone:                    formData.get('phone') as string,
      dni:                      formData.get('dni') as string,
      birth_date:               formData.get('birth_date') as string,
      emergency_contact_name:   (formData.get('emergency_contact_name') as string) || undefined,
      emergency_contact_phone:  (formData.get('emergency_contact_phone') as string) || undefined,
      terms_accepted:           formData.get('terms_accepted') === 'on' ? true : undefined,
      privacy_accepted:         formData.get('privacy_accepted') === 'on' ? true : undefined,
    };

    try {
      const res = await fetch('/api/tenant/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json() as {
        tenant?: { id: string; email: string; full_name: string };
        syncStatus?: string;
        syncError?: string;
        error?: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
      };

      if (!res.ok) {
        if (json.error?.code === 'VALIDATION_ERROR' && json.error.details?.fieldErrors) {
          setFieldErrors(json.error.details.fieldErrors);
          setStatus('idle');
          return;
        }
        setGlobalError(json.error?.message ?? 'Ocurrió un error. Inténtalo de nuevo.');
        setStatus('error');
        return;
      }

      if (json.syncStatus === 'failed') {
        setSyncWarning('Tu cuenta fue creada. La sincronización con Airtable falló y será reintentada por el administrador.');
        setStatus('airtable_failed');
      } else {
        setStatus('success');
      }

      // Redirect to portal regardless of sync status
      router.push('/portal');

    } catch {
      setGlobalError('Error de red. Verifica tu conexión e inténtalo de nuevo.');
      setStatus('error');
    }
  }

  const isLoading = status === 'loading';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Partial success warning */}
      {syncWarning && (
        <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          {syncWarning}
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {globalError}
        </div>
      )}

      {/* Personal fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id="first_name"
          label={tenantRegistrationLabels.first_name}
          name="first_name"
          required
          maxLength={100}
          errors={fieldErrors.first_name}
          disabled={isLoading}
        />
        <FormField
          id="last_name"
          label={tenantRegistrationLabels.last_name}
          name="last_name"
          required
          maxLength={100}
          errors={fieldErrors.last_name}
          disabled={isLoading}
        />
      </div>

      <FormField
        id="email"
        label={tenantRegistrationLabels.email}
        name="email"
        type="email"
        required
        autoComplete="email"
        errors={fieldErrors.email}
        disabled={isLoading}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id="phone"
          label={tenantRegistrationLabels.phone}
          name="phone"
          type="tel"
          required
          maxLength={20}
          errors={fieldErrors.phone}
          disabled={isLoading}
        />
        <FormField
          id="dni"
          label={tenantRegistrationLabels.dni}
          name="dni"
          required
          maxLength={20}
          errors={fieldErrors.dni}
          disabled={isLoading}
        />
      </div>

      <FormField
        id="birth_date"
        label={tenantRegistrationLabels.birth_date}
        name="birth_date"
        type="date"
        required
        errors={fieldErrors.birth_date}
        disabled={isLoading}
      />

      {/* Emergency contact (optional) */}
      <div className="pt-2 border-t border-slate-100">
        <p className="text-xs text-slate-500 mb-3">Contacto de emergencia (opcional)</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id="emergency_contact_name"
            label={tenantRegistrationLabels.emergency_contact_name}
            name="emergency_contact_name"
            maxLength={100}
            errors={fieldErrors.emergency_contact_name}
            disabled={isLoading}
          />
          <FormField
            id="emergency_contact_phone"
            label={tenantRegistrationLabels.emergency_contact_phone}
            name="emergency_contact_phone"
            type="tel"
            maxLength={20}
            errors={fieldErrors.emergency_contact_phone}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Terms + Privacy checkboxes */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <CheckboxField
          id="terms_accepted"
          name="terms_accepted"
          label={tenantRegistrationLabels.terms_accepted}
          required
          errors={fieldErrors.terms_accepted}
          disabled={isLoading}
        />
        <CheckboxField
          id="privacy_accepted"
          name="privacy_accepted"
          label={tenantRegistrationLabels.privacy_accepted}
          required
          errors={fieldErrors.privacy_accepted}
          disabled={isLoading}
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={[
          'w-full inline-flex items-center justify-center gap-2',
          'h-11 px-4 rounded-md text-sm font-medium transition-colors duration-150',
          'bg-brand-600 text-white shadow-sm',
          'hover:bg-brand-700 active:bg-brand-800',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-brand-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Guardando...</span>
          </>
        ) : (
          <span>Completar registro</span>
        )}
      </button>
    </form>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface FormFieldProps {
  id: string;
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  errors?: string[];
  disabled?: boolean;
}

function FormField({ id, label, name, type = 'text', required, maxLength, autoComplete, errors, disabled }: FormFieldProps) {
  const hasError = errors && errors.length > 0;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={[
          'w-full rounded-md border text-sm transition-colors duration-150',
          'px-3 py-2 h-10',
          'text-slate-900 placeholder-slate-400',
          hasError ? 'border-red-400 focus:ring-red-500' : 'border-slate-300 focus:ring-brand-500',
          'bg-white focus:outline-none focus:ring-2 focus:border-transparent',
          'disabled:bg-slate-50 disabled:text-slate-500',
        ].join(' ')}
      />
      {hasError && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

interface CheckboxFieldProps {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  errors?: string[];
  disabled?: boolean;
}

function CheckboxField({ id, name, label, required, errors, disabled }: CheckboxFieldProps) {
  const hasError = errors && errors.length > 0;
  return (
    <div>
      <label htmlFor={id} className="inline-flex items-start gap-2 cursor-pointer">
        <input
          id={id}
          name={name}
          type="checkbox"
          required={required}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
      {hasError && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
