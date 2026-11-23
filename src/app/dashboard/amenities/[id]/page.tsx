import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { bookingsForDay, getAmenity, propertyTenantOptions } from '@/lib/amenities/amenities';
import { daySlots, slotGrid } from '@/lib/amenities/slot-math';
import { BookSlotForm } from '@/components/amenities/BookSlotForm';
import { CancelBookingButton } from '@/components/amenities/CancelBookingButton';
import { DayNav } from '@/components/amenities/DayNav';

export const metadata: Metadata = { title: 'Common area schedule' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AmenitySchedulePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('amenities');
  const [{ id }, { date: rawDate }] = await Promise.all([params, searchParams]);
  const today = new Date().toISOString().slice(0, 10);
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : today;

  const amenity = await getAmenity(ctx.orgId, id);
  if (!amenity) notFound();
  const [bookings, tenantOptions] = await Promise.all([
    bookingsForDay(ctx.orgId, amenity.id, date),
    propertyTenantOptions(ctx.orgId, amenity.propertyId),
  ]);
  const grid = slotGrid(daySlots(amenity.openTime, amenity.closeTime, amenity.slotMinutes), bookings);
  const bookable = amenity.active && date >= today;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/dashboard/amenities" className="text-sm text-slate-500 hover:underline">{t('back')}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{amenity.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{amenity.propertyName} · {amenity.openTime}–{amenity.closeTime}</p>
        </div>
        <DayNav date={date} basePath={`/dashboard/amenities/${amenity.id}`} />
      </div>

      <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100" aria-label={t('slotsFor', { date })}>
        {grid.map((slot) => (
          <li key={slot.start} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium tabular-nums text-slate-900">{slot.start}–{slot.end}</span>
            {slot.booking ? (
              <span className="flex items-center gap-3 text-sm text-slate-700">
                {slot.booking.tenantName ?? t('bookedByAdmin')}
                <CancelBookingButton bookingId={slot.booking.id} />
              </span>
            ) : bookable ? (
              <BookSlotForm amenityId={amenity.id} bookedOn={date} startTime={slot.start} tenants={tenantOptions} />
            ) : (
              <span className="text-sm text-slate-400">{t('free')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
