/**
 * /dashboard/admin/import/phantom-rooms
 *
 * Phantom Rooms (AC19):
 * - Table of phantom_rooms with all resolutions
 * - Each row: raw_room_label, dropdown to select matching unit (from units table), "Map" button
 * - Calls savePhantomRoomMapping Server Action
 * - Shows "Ignore" option for invalid rooms
 * - Mapped/ignored rooms show status badges
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';
import { PhantomRoomForm } from './PhantomRoomForm';

export const dynamic = 'force-dynamic';

interface Unit {
  id: string;
  label: string;
  property_name: string | null;
}

interface PhantomRoom {
  id: string;
  raw_room_label: string;
  matched_unit_id: string | null;
  resolution: string;
  resolved_at: string | null;
}

export default async function PhantomRoomsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  const supabase = await createClient();

  // Fetch all phantom rooms
  const { data: phantomRooms, error: phantomError } = await supabase
    .from('phantom_rooms')
    .select('id, raw_room_label, matched_unit_id, resolution, resolved_at')
    .order('raw_room_label', { ascending: true });

  // Fetch available units for the dropdown
  const { data: unitsData, error: unitsError } = await supabase
    .from('units')
    .select('id, label, property_id')
    .order('label', { ascending: true });

  // Fetch property names for units
  const { data: propertiesData } = await supabase
    .from('properties')
    .select('id, name');

  const propertyMap = new Map<string, string>(
    (propertiesData ?? []).map((p: { id: string; name: string }) => [p.id, p.name])
  );

  const units: Unit[] = (unitsData ?? []).map((u: { id: string; label: string; property_id: string }) => ({
    id: u.id,
    label: u.label,
    property_name: propertyMap.get(u.property_id) ?? null,
  }));

  const rooms: PhantomRoom[] = phantomRooms ?? [];
  const t = await getTranslations('adminImport.phantomRooms');

  const pendingRooms = rooms.filter((r) => r.resolution === 'pending' || !r.resolution);
  const resolvedRooms = rooms.filter((r) => r.resolution === 'mapped' || r.resolution === 'ignored');

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <span className="font-medium">{t('bannerBold')}</span> — {t('banner')}
      </div>

      {(phantomError || unitsError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700" role="alert">
          {t('loadError')}
        </div>
      )}

      {/* Pending phantom rooms */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            {t('pendingTitle')}
            {pendingRooms.length > 0 && (
              <span className="ml-2 bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
                {pendingRooms.length}
              </span>
            )}
          </h2>
        </div>

        {pendingRooms.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            {t('pendingEmpty')}
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="phantom-rooms-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colCsvLabel')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTargetUnit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {pendingRooms.map((room) => (
                <tr key={room.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-700 text-sm">{room.raw_room_label}</td>
                  <td className="px-4 py-3" colSpan={2}>
                    <PhantomRoomForm
                      label={room.raw_room_label}
                      units={units}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Resolved phantom rooms */}
      {resolvedRooms.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-800">
              {t('resolvedTitle')}
              <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                {resolvedRooms.length}
              </span>
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colCsvLabel')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colResolution')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colUnit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {resolvedRooms.map((room) => {
                const unit = units.find((u) => u.id === room.matched_unit_id);
                return (
                  <tr key={room.id} className="border-b border-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700 text-sm">{room.raw_room_label}</td>
                    <td className="px-4 py-3">
                      {room.resolution === 'mapped' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          {t('statusMapped')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                          {t('statusIgnored')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unit ? `${unit.label}${unit.property_name ? ` — ${unit.property_name}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {room.resolved_at ? new Date(room.resolved_at).toLocaleDateString('es-AR') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
