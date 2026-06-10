'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  photo_url: string | null;
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
  photo_url: string;
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
  const t = useTranslations('adminTenants');
  const creating = isNew(tenantId);

  const [tenant, setTenant]     = useState<TenantDetail | null>(null);
  const [loading, setLoading]   = useState(!creating);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState(false);
  const [inviting, setInviting]     = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; emailSent: boolean; expiresAt: string } | null>(null);
  const [inviteError, setInviteError]   = useState<string | null>(null);

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
    photo_url: '',
  });

  useEffect(() => {
    if (creating) return;
    setLoading(true);
    void fetch(`/api/admin/tenants/${tenantId}`)
      .then(r => r.json())
      .then((json: { tenant?: TenantDetail; error?: unknown }) => {
        if (json.tenant) {
          const ten = json.tenant;
          setTenant(ten);
          setForm({
            first_name:               ten.first_name               ?? '',
            last_name:                ten.last_name                ?? '',
            email:                    ten.email                    ?? '',
            phone:                    ten.phone                    ?? '',
            dni:                      ten.dni                      ?? '',
            birth_date:               ten.birth_date               ?? '',
            emergency_contact_name:   ten.emergency_contact_name   ?? '',
            emergency_contact_phone:  ten.emergency_contact_phone  ?? '',
            tenant_status:            ten.tenant_status            ?? 'pending',
            notes:                    ten.notes                    ?? '',
            preferred_language:       ten.preferred_language       ?? 'es',
            photo_url:                ten.photo_url                ?? '',
          });
        }
      })
      .catch(() => setError(t('errorLoading')))
      .finally(() => setLoading(false));
  }, [tenantId, creating, t]);

  async function handleSendInvite() {
    setInviteError(null);
    setInviteResult(null);
    setInviting(true);
    try {
      const res  = await fetch(`/api/admin/tenants/${tenantId}/invite`, { method: 'POST' });
      const json = await res.json() as {
        invited?: boolean;
        inviteUrl?: string;
        emailSent?: boolean;
        expiresAt?: string;
        error?: { message?: string };
      };
      if (!res.ok || !json.invited) {
        setInviteError(json.error?.message ?? t('errorLoading'));
        return;
      }
      setInviteResult({ inviteUrl: json.inviteUrl!, emailSent: json.emailSent ?? false, expiresAt: json.expiresAt! });
      // Reflect portal_access='invited' in local state
      setTenant(prev => prev ? { ...prev, portal_access: 'invited' } : prev);
    } catch {
      setInviteError(t('errorLoading'));
    } finally {
      setInviting(false);
    }
  }

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
        photo_url:                form.photo_url    || undefined,
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
        setError(json.error?.message ?? t('errorLoading'));
        return;
      }

      if (json.syncStatus === 'failed') {
        setSyncWarning(true);
      }

      if (creating && json.tenant) {
        router.push(`/dashboard/admin/tenants/${json.tenant.id}`);
        return;
      }

      setSuccess(t('saveChanges'));
      if (json.tenant) setTenant(json.tenant);
    } catch {
      setError(t('errorLoading'));
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

  const pageTitle = creating
    ? t('newTenant')
    : (tenant?.first_name ? `${tenant.first_name} ${tenant.last_name ?? ''}`.trim() : t('editTenant'));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{pageTitle}</h1>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          {t('back')}
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
          {t('syncWarning')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Section 1: Personal Information */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">{t('sectionPersonal')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="first_name">
                {t('fieldFirstName')} <span className="text-red-500">*</span>
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
                {t('fieldLastName')} <span className="text-red-500">*</span>
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
                {t('fieldEmail')} <span className="text-red-500">*</span>
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
                {t('fieldPhone')} <span className="text-red-500">*</span>
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
                {t('fieldDni')}
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
                {t('fieldBirthDate')}
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

        {/* Photo */}
        {!creating && (
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">{t('sectionPhoto')}</h2>
            <div className="flex items-start gap-4">
              {form.photo_url ? (
                <img
                  src={form.photo_url}
                  alt={t('photoAlt')}
                  className="w-16 h-16 rounded-full object-cover border border-slate-200 flex-shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200">
                  <span className="text-2xl text-slate-400 select-none">
                    {(form.first_name?.[0] ?? '?').toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="photo_url">
                  {t('photoUrlLabel')}
                </label>
                <input
                  id="photo_url"
                  name="photo_url"
                  type="url"
                  value={form.photo_url}
                  onChange={field('photo_url')}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-xs text-slate-400 mt-1">{t('photoUrlNote')}</p>
              </div>
            </div>
          </section>
        )}

        {/* Section 2: Emergency Contact */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">
            {t('sectionEmergency')} <span className="text-xs font-normal text-slate-400">{t('sectionEmergencyOptional')}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="emergency_contact_name">
                {t('fieldEmergencyName')}
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
                {t('fieldEmergencyPhone')}
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

        {/* Section 3: Property Assignment (read-only) */}
        {!creating && tenant && (
          <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-base font-semibold text-slate-800">{t('sectionProperty')}</h2>
            <p className="text-xs text-slate-500">{t('sectionPropertyNote')}</p>
            {tenant.units ? (
              <p className="text-sm text-slate-700">
                {tenant.units.properties?.name ?? ''}{tenant.units.properties?.name ? ' — ' : ''}{tenant.units.label}
              </p>
            ) : (
              <p className="text-sm text-slate-400">{t('unassigned')}</p>
            )}
          </section>
        )}

        {/* Section 4: Status & Integration */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">{t('sectionStatus')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="tenant_status">
                {t('fieldTenantStatus')}
              </label>
              <select
                id="tenant_status"
                name="tenant_status"
                value={form.tenant_status}
                onChange={field('tenant_status')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="pending">{t('statusPending')}</option>
                <option value="active">{t('statusActive')}</option>
                <option value="inactive">{t('statusInactive')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="preferred_language">
                {t('fieldLanguage')}
              </label>
              <select
                id="preferred_language"
                name="preferred_language"
                value={form.preferred_language}
                onChange={field('preferred_language')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="es">{t('langEs')}</option>
                <option value="en">{t('langEn')}</option>
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
                  {t('lastSync', { date: new Date(tenant.last_synced_at).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) })}
                </p>
              )}
              {tenant.airtable_external_id && (
                <p className="text-xs text-slate-400">
                  {t('airtableId')} <span className="font-mono">{tenant.airtable_external_id}</span>
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-slate-500">{t('portalAccess')}</span>
                <Badge variant={
                  tenant.portal_access === 'active'      ? 'success' :
                  tenant.portal_access === 'invited'     ? 'info'    :
                  tenant.portal_access === 'suspended'   ? 'danger'  : 'default'
                }>
                  {tenant.portal_access ?? 'not_invited'}
                </Badge>
                {tenant.portal_access !== 'active' && (
                  <button
                    type="button"
                    onClick={handleSendInvite}
                    disabled={inviting}
                    className="text-xs text-brand-600 hover:underline disabled:opacity-60"
                  >
                    {inviting ? t('sending') : tenant.portal_access === 'invited' ? t('resendInvite') : t('sendInvite')}
                  </button>
                )}
              </div>
              {inviteError && (
                <div role="alert" className="text-xs text-red-600 mt-1">{inviteError}</div>
              )}
              {inviteResult && (
                <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
                  <p className="text-xs text-green-700 font-medium">
                    {inviteResult.emailSent ? t('inviteSentEmail') : t('inviteCreatedManual')}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteResult.inviteUrl}
                      className="flex-1 text-xs font-mono bg-white border border-green-200 rounded px-2 py-1 truncate"
                    />
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(inviteResult.inviteUrl)}
                      className="text-xs text-brand-600 hover:underline whitespace-nowrap"
                    >
                      {t('copyLink')}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    {t('inviteExpires', { date: new Date(inviteResult.expiresAt).toLocaleDateString('es', { dateStyle: 'medium' }) })}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 5: Internal notes */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">{t('sectionNotes')}</h2>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            value={form.notes}
            onChange={field('notes')}
            placeholder={t('notesPlaceholder')}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
        </section>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {creating ? t('createTenant') : t('saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  );
}
