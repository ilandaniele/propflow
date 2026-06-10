'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';

interface TenantDetail {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  dni: string | null;
  birth_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  tenant_status: string | null;
  portal_access: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
  airtable_external_id: string | null;
  preferred_language: string | null;
  notes: string | null;
  responsable_id: string | null;
  unit_id: string | null;
  units?: { label: string; properties?: { name: string } | null } | null;
  responsables?: { full_name: string } | null;
}

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  dni: string;
  birth_date: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  tenant_status: string;
  notes: string;
  preferred_language: string;
}

function syncStatusVariant(s: string | null): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (s) {
    case 'synced':       return 'success';
    case 'pending':      return 'warning';
    case 'failed':       return 'danger';
    case 'needs_review': return 'info';
    default:             return 'default';
  }
}

const isNew = (tenantId: string) => tenantId === 'new';

export default function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const router = useRouter();
  const creating = isNew(tenantId);

  const [tenant, setTenant]     = useState<TenantDetail | null>(null);
  const [loading, setLoading]   = useState(!creating);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState(false);

  const [form, setForm] = useState<FormState>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    dni: '',
    birth_date: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    tenant_status: 'pending',
    notes: '',
    preferred_language: 'es',
  });

  useEffect(() => {
    if (creating) return;
    setLoading(true);
    void fetch(`/api/admin/tenants/${tenantId}`)
      .then(r => r.json())
      .then((json: { tenant?: TenantDetail; error?: unknown }) => {
        if (json.tenant) {
          const t = json.tenant;
          setTenant(t);
          setForm({
            first_name:               t.first_name               ?? '',
            last_name:                t.last_name                ?? '',
            email:                    t.email                    ?? '',
            phone:                    t.phone                    ?? '',
            dni:                      t.dni                      ?? '',
            birth_date:               t.birth_date               ?? '',
            emergency_contact_name:   t.emergency_contact_name   ?? '',
            emergency_contact_phone:  t.emergency_contact_phone  ?? '',
            tenant_status:            t.tenant_status            ?? 'pending',
            notes:                    t.notes                    ?? '',
            preferred_language:       t.preferred_language       ?? 'es',
          });
        }
      })
      .catch(() => setError('No se pudo cargar el inquilino.'))
      .finally(() => setLoading(false));
  }, [tenantId, creating]);

  const field = (name: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [name]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSyncWarning(false);
    setSaving(true);

    try {
      const url    = creating ? '/api/admin/tenants' : `/api/admin/tenants/${tenantId}`;
      const method = creating ? 'POST' : 'PATCH';

      const payload: Record<string, unknown> = {
        first_name:               form.first_name   || undefined,
        last_name:                form.last_name    || undefined,
        email:                    form.email        || undefined,
        phone:                    form.phone        || undefined,
        dni:                      form.dni          || undefined,
        birth_date:               form.birth_date   || undefined,
        emergency_contact_name:   form.emergency_contact_name  || undefined,
        emergency_contact_phone:  form.emergency_contact_phone || undefined,
        tenant_status:            form.tenant_status,
        notes:                    form.notes        || undefined,
        preferred_language:       form.preferred_language,
      };

      // For POST we need email + required fields, skip undefined
      const body = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined)
      );

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as {
        tenant?: TenantDetail;
        syncStatus?: string;
        error?: { message?: string };
      };

      if (!res.ok) {
        setError(json.error?.message ?? 'Error al guardar.');
        return;
      }

      if (json.syncStatus === 'failed') {
        setSyncWarning(true);
      }

      if (creating && json.tenant) {
        router.push(`/dashboard/admin/tenants/${json.tenant.id}`);
        return;
      }

      setSuccess('Cambios guardados correctamente.');
      if (json.tenant) setTenant(json.tenant);
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const pageTitle = creating ? 'Nuevo inquilino' : (tenant?.first_name ? `${tenant.first_name} ${tenant.last_name ?? ''}`.trim() : 'Editar inquilino');

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{pageTitle}</h1>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Volver
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
          {success}
        </div>
      )}
      {syncWarning && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3">
          Los datos se guardaron en PropFlow, pero la sincronizacion con Airtable fallo. Reintenta desde la pagina de integraciones.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Section 1: Informacion Personal */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">Informacion Personal</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="first_name">
                Nombre(s) <span className="text-red-500">*</span>
              </label>
              <input
                id="first_name"
                name="first_name"
                type="text"
                required
                value={form.first_name}
                onChange={field('first_name')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="last_name">
                Apellido(s) <span className="text-red-500">*</span>
              </label>
              <input
                id="last_name"
                name="last_name"
                type="text"
                required
                value={form.last_name}
                onChange={field('last_name')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="email">
                Correo electronico <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={field('email')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="phone">
                Numero celular <span className="text-red-500">*</span>
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                required
                value={form.phone}
                onChange={field('phone')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="dni">
                N° DNI
              </label>
              <input
                id="dni"
                name="dni"
                type="text"
                value={form.dni}
                onChange={field('dni')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="birth_date">
                Fecha de nacimiento
              </label>
              <input
                id="birth_date"
                name="birth_date"
                type="date"
                value={form.birth_date}
                onChange={field('birth_date')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </section>

        {/* Section 2: Contacto de Emergencia */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">Contacto de Emergencia <span className="text-xs font-normal text-slate-400">(opcional)</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="emergency_contact_name">
                Nombre
              </label>
              <input
                id="emergency_contact_name"
                name="emergency_contact_name"
                type="text"
                value={form.emergency_contact_name}
                onChange={field('emergency_contact_name')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="emergency_contact_phone">
                Telefono
              </label>
              <input
                id="emergency_contact_phone"
                name="emergency_contact_phone"
                type="tel"
                value={form.emergency_contact_phone}
                onChange={field('emergency_contact_phone')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </section>

        {/* Section 3: Asignacion de Propiedad (read-only) */}
        {!creating && tenant && (
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-base font-semibold text-slate-800">Asignacion de Propiedad</h2>
            <p className="text-xs text-slate-500">La asignacion se gestiona desde el contrato.</p>
            {tenant.units ? (
              <p className="text-sm text-slate-700">
                {tenant.units.properties?.name ?? ''}{tenant.units.properties?.name ? ' — ' : ''}{tenant.units.label}
              </p>
            ) : (
              <p className="text-sm text-slate-400">Sin asignar</p>
            )}
          </section>
        )}

        {/* Section 4: Estado e Integracion */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">Estado e Integracion</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="tenant_status">
                Estado del inquilino
              </label>
              <select
                id="tenant_status"
                name="tenant_status"
                value={form.tenant_status}
                onChange={field('tenant_status')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="pending">Pendiente</option>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="preferred_language">
                Idioma preferido
              </label>
              <select
                id="preferred_language"
                name="preferred_language"
                value={form.preferred_language}
                onChange={field('preferred_language')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="es">Espanol</option>
                <option value="en">Ingles</option>
              </select>
            </div>
          </div>

          {/* Sync info (read-only, only on edit) */}
          {!creating && tenant && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">Sync:</span>
                <Badge variant={syncStatusVariant(tenant.sync_status)}>
                  {tenant.sync_status ?? 'pending'}
                </Badge>
              </div>
              {tenant.last_synced_at && (
                <p className="text-xs text-slate-400">
                  Ultima sincronizacion: {new Date(tenant.last_synced_at).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
              {tenant.airtable_external_id && (
                <p className="text-xs text-slate-400">
                  Airtable ID: <span className="font-mono">{tenant.airtable_external_id}</span>
                </p>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">Acceso portal:</span>
                <span className="text-xs text-slate-600">{tenant.portal_access ?? 'not_invited'}</span>
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:underline cursor-not-allowed opacity-60"
                  disabled
                  title="Funcionalidad proxima"
                >
                  Enviar invitacion
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Section 5: Notas internas */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">Notas internas</h2>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            value={form.notes}
            onChange={field('notes')}
            placeholder="Notas solo visibles para el equipo admin…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
        </section>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {creating ? 'Crear inquilino' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  );
}
