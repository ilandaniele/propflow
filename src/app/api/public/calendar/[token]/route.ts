import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, publicAssetRateLimit } from '@/lib/ratelimit';
import { getCalendarByToken, listUnitOccupancy } from '@/lib/unit-calendar/queries';
import { contractsToEvents } from '@/lib/unit-calendar/occupancy';
import { toIcal } from '@/lib/unit-calendar/ical';

export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** GET /api/public/calendar/[token](.ics): the unit's occupancy as iCal, for Airbnb / Booking / Vrbo to import. No tenant data. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  if (!publicAssetRateLimit(getClientIp(request)).success) return new NextResponse(null, { status: 429 });

  const token = (await params).token.replace(/\.ics$/, '');
  if (!TOKEN_PATTERN.test(token)) return new NextResponse(null, { status: 404 });

  const calendar = await getCalendarByToken(token);
  if (!calendar) return new NextResponse(null, { status: 404 });

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const occupancy = await listUnitOccupancy(calendar.orgId, calendar.unitId, today);
  const ics = toIcal(contractsToEvents(occupancy, today), { name: calendar.unitLabel, now });

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
    },
  });
}
