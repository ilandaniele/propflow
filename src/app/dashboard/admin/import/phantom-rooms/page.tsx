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
import { db } from '@/lib/db';
import { phantomRooms, units, properties } from '@/lib/db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { PhantomRoomForm } from './PhantomRoomForm';

export const dynamic = 'force-dynamic';

export default async function PhantomRoomsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('adminImport.phantomRooms');

  const [rooms, unitRows] = await Promise.all([
    db
      .select({
        id:            phantomRooms.id,
        rawRoomLabel:  phantomRooms.rawRoomLabel,
        matchedUnitId: phantomRooms.matchedUnitId,
        resolution:    phantomRooms.resolution,
        resolvedAt:    phantomRooms.resolvedAt,
      })
      .from(phantomRooms)
      .where(eq(phantomRooms.orgId, ctx.orgId))
      .orderBy(asc(phantomRooms.rawRoomLabel)),
    db
      .select({
        id:           units.id,
        label:        units.label,
        propertyName: properties.name,
      })
      .from(units)
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(eq(units.orgId, ctx.orgId))
      .orderBy(asc(units.label)),
  ]);

  const unitList = unitRows.map((u) => ({ id: u.id, label: u.label, property_name: u.propertyName ?? null }));

  const pendingRooms  = rooms.filter((r) => r.resolution === 'pending' || !r.resolution);
  const resolvedRooms = rooms.filter((r) => r.resolution === 'mapped' || r.resolution === 'ignored');

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <span className="font-medium">{t('bannerBold')}</span> — {t('banner')}
      </div>

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
                  <td className="px-4 py-3 font-mono text-slate-700 text-sm">{room.rawRoomLabel}</td>
                  <td className="px-4 py-3" colSpan={2}>
                    <PhantomRoomForm label={room.rawRoomLabel} units={unitList} />
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
                const unit = unitList.find((u) => u.id === room.matchedUnitId);
                return (
                  <tr key={room.id} className="border-b border-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700 text-sm">{room.rawRoomLabel}</td>
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
                      {room.resolvedAt ? new Date(room.resolvedAt).toLocaleDateString('es-AR') : '—'}
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
