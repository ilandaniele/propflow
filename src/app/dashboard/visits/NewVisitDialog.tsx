'use client';

/**
 * "Nueva visita" dialog for /dashboard/visits — books a visit against an
 * existing lead or a freshly-created one. Native <dialog> element, same
 * pattern as AgentModal (src/components/executive-brief/AgentModal.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { createVisitManual } from '@/app/actions/visits';

export interface AdvisorOption {
  id: string;
  fullName: string;
}

export interface ListingOption {
  id: string;
  title: string;
}

export interface LeadOption {
  id: string;
  fullName: string;
  phone: string | null;
}

export interface NewVisitDialogProps {
  onClose: () => void;
  onCreated: () => void;
  advisors: AdvisorOption[];
  listings: ListingOption[];
  recentLeads: LeadOption[];
  defaultDate: string;
}

/**
 * Mounted only while open (see VisitsWeekClient, which conditionally renders
 * `{dialogOpen && <NewVisitDialog .../>}`) — every mount starts from fresh
 * state, so there is no need for a reset-on-open effect.
 */
export function NewVisitDialog({ onClose, onCreated, advisors, listings, recentLeads, defaultDate }: NewVisitDialogProps) {
  const t = useTranslations('visits');
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [leadMode, setLeadMode] = useState<'existing' | 'new'>('existing');
  const [leadId, setLeadId] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [listingId, setListingId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('10:00');
  const [visitMinutes, setVisitMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase();
    if (!q) return recentLeads;
    return recentLeads.filter((l) => l.fullName.toLowerCase().includes(q) || (l.phone ?? '').includes(q));
  }, [recentLeads, leadSearch]);

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
  }

  function handleCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    onClose();
  }

  async function handleSubmit() {
    setError(null);
    if (!profileId || !date || !time) {
      setError(t('errors.VALIDATION_ERROR'));
      return;
    }
    if (leadMode === 'existing' && !leadId) {
      setError(t('errors.VALIDATION_ERROR'));
      return;
    }
    if (leadMode === 'new' && !newLeadName.trim()) {
      setError(t('errors.VALIDATION_ERROR'));
      return;
    }

    const [h, m] = time.split(':').map(Number);
    setSubmitting(true);
    try {
      const result = await createVisitManual({
        leadId: leadMode === 'existing' ? leadId : undefined,
        newLead: leadMode === 'new' ? { fullName: newLeadName.trim(), phone: newLeadPhone.trim() || undefined } : undefined,
        listingId: listingId || null,
        profileId,
        date,
        startMinute: h * 60 + m,
        visitMinutes: visitMinutes ? Number(visitMinutes) : undefined,
        notes: notes.trim() || undefined,
      });
      if (result.error) {
        const code = result.error.code;
        const key = (['CONFLICT', 'NOT_FOUND', 'VALIDATION_ERROR'].includes(code) ? code : 'generic') as
          | 'CONFLICT'
          | 'NOT_FOUND'
          | 'VALIDATION_ERROR'
          | 'generic';
        setError(t(`errors.${key}`));
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      onCancel={handleCancel}
      className="rounded-xl shadow-lg p-0 backdrop:bg-black/30 w-full max-w-lg"
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t('dialog.title')}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('dialog.close')}>
            ✕
          </button>
        </div>

        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setLeadMode('existing')}
            className={`px-2 py-1 rounded-md border ${leadMode === 'existing' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200'}`}
          >
            {t('dialog.leadModeExisting')}
          </button>
          <button
            type="button"
            onClick={() => setLeadMode('new')}
            className={`px-2 py-1 rounded-md border ${leadMode === 'new' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200'}`}
          >
            {t('dialog.leadModeNew')}
          </button>
        </div>

        {leadMode === 'existing' ? (
          <div className="space-y-1">
            <input
              type="text"
              placeholder={t('dialog.searchLead')}
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            >
              <option value="">{t('dialog.selectLead')}</option>
              {filteredLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName}
                  {l.phone ? ` — ${l.phone}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t('dialog.fullName')}
              value={newLeadName}
              onChange={(e) => setNewLeadName(e.target.value)}
              className="text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
            <input
              type="text"
              placeholder={t('dialog.phone')}
              value={newLeadPhone}
              onChange={(e) => setNewLeadPhone(e.target.value)}
              className="text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </div>
        )}

        <label className="block text-sm text-slate-700 space-y-1">
          {t('dialog.listing')}
          <select
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
          >
            <option value="">{t('dialog.noListing')}</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-slate-700 space-y-1">
          {t('dialog.advisor')}
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
          >
            <option value="">{t('dialog.selectAdvisor')}</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-sm text-slate-700 space-y-1">
            {t('dialog.date')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="block text-sm text-slate-700 space-y-1">
            {t('dialog.time')}
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="block text-sm text-slate-700 space-y-1">
            {t('dialog.visitMinutes')}
            <input
              type="number"
              min={10}
              max={240}
              value={visitMinutes}
              onChange={(e) => setVisitMinutes(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
        </div>

        <label className="block text-sm text-slate-700 space-y-1">
          {t('dialog.notes')}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('dialog.close')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {submitting ? t('dialog.submitting') : t('dialog.submit')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
