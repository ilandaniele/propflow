import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { bookingsForDay, listAmenities, tenantScope, upcomingTenantBookings } from '@/lib/amenities/amenities';
import { daySlots, slotGrid } from '@/lib/amenities/slot-math';
import { BookSlotForm } from '@/components/amenities/BookSlotForm';
import { CancelBookingButton } from '@/components/amenities/CancelBookingButton';
import { DayNav } from '@/components/amenities/DayNav';
import { BookingSummary } from '@/components/amenities/BookingSummary';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Bookings' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PortalAmenitiesPage({ searchParams }: { searchParams: Promise<{ amenity?: string; date?: string }> }) {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }
  const t = await getTranslations('amenities');
  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = query.date && DATE_RE.test(query.date) && query.date >= today ? query.date : today;

  const scope = await tenantScope(ctx.orgId, ctx.userId);
  if (!scope) {
    return <Card><EmptyState title={t('portal.noContractTitle')} description={t('portal.noContractDesc')} /></Card>;
  }

  const [options, mine] = await Promise.all([
    listAmenities(ctx.orgId, scope.propertyId),
    upcomingTenantBookings(ctx.orgId, scope.tenantId, today),
  ]);
  const selected = options.find((option) => option.id === query.amenity) ?? options[0];
  const grid = selected
    ? slotGrid(daySlots(selected.openTime, selected.closeTime, selected.slotMinutes), await bookingsForDay(ctx.orgId, selected.id, date))
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">{t('portal.title')}</h1>

      {mine.length > 0 && (
        <section aria-labelledby="my-bookings" className="space-y-2">
          <h2 id="my-bookings" className="text-sm font-semibold text-slate-700">{t('portal.mine')}</h2>
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {mine.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <BookingSummary
                  label={<><span className="font-medium text-slate-900">{booking.amenityName}</span> · <span className="tabular-nums">{booking.bookedOn} {booking.startTime}–{booking.endTime}</span></>}
                  guestCount={booking.guestCount}
                  comment={booking.comment}
                />
                <CancelBookingButton bookingId={booking.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!selected ? (
        <Card><EmptyState title={t('portal.noAmenitiesTitle')} description={t('portal.noAmenitiesDesc')} /></Card>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex flex-wrap gap-2" aria-label={t('portal.pick')}>
              {options.map((option) => (
                <Link
                  key={option.id}
                  href={`/portal/amenities?${new URLSearchParams({ amenity: option.id, date })}`}
                  aria-current={option.id === selected.id ? 'page' : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${option.id === selected.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                >
                  {option.name}
                </Link>
              ))}
            </nav>
            <DayNav date={date} basePath="/portal/amenities" query={{ amenity: selected.id }} />
          </div>
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100" aria-label={t('slotsFor', { date })}>
            {grid.map((slot) => (
              <li key={slot.start} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium tabular-nums text-slate-900">{slot.start}–{slot.end}</span>
                {!slot.booking ? (
                  <BookSlotForm amenityId={selected.id} bookedOn={date} startTime={slot.start} capacity={selected.capacity} />
                ) : slot.booking.tenantId === scope.tenantId ? (
                  <span className="flex items-center gap-3 text-sm text-green-700">{t('portal.yours')}<CancelBookingButton bookingId={slot.booking.id} /></span>
                ) : (
                  <span className="text-sm text-slate-400">{t('portal.taken')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
