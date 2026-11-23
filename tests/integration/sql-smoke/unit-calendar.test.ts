import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeHandle } from './setup';

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), adminAction: vi.fn() } }));

let smoke: SmokeHandle;
const queries = await import('@/lib/unit-calendar/queries');
const { syncUnitCalendar, syncDueUnitCalendars } = await import('@/lib/unit-calendar/sync');
const { GET } = await import('@/app/api/public/calendar/[token]/route');

const FEED = (uid: string) =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20991201\r\nDTEND;VALUE=DATE:20991205\r\nUID:${uid}\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

beforeAll(async () => {
  smoke = await createSmokeDb();
});

afterAll(async () => {
  await smoke?.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedUnit(label = 'Depa 101') {
  const org = await seedOrg(smoke.db);
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db.insert(schema.units).values({ id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label, createdAt: new Date(), updatedAt: new Date() }).returning();
  return { org, unit };
}

async function seedContract(orgId: string, unitId: string, values: { startDate: string; endDate: string | null; status?: string }) {
  const [tenant] = await smoke.db.insert(schema.tenants).values({ id: crypto.randomUUID(), orgId, fullName: 'Tenant', createdAt: new Date(), updatedAt: new Date() }).returning();
  await smoke.db.insert(schema.contracts).values({ id: crypto.randomUUID(), orgId, unitId, tenantId: tenant.id, monthlyRent: '1000', createdAt: new Date(), updatedAt: new Date(), ...values });
}

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('unit calendar', () => {
  it('creates one calendar per unit with a 64-hex export token', async () => {
    const { org, unit } = await seedUnit();
    await queries.createUnitCalendar(org.id, unit.id);
    await queries.createUnitCalendar(org.id, unit.id);
    const calendar = await queries.getUnitCalendar(org.id, unit.id);
    expect(calendar?.exportToken).toMatch(/^[a-f0-9]{64}$/);
    const other = await seedOrg(smoke.db);
    expect(await queries.getUnitCalendar(other.id, unit.id)).toBeNull();
    expect(await queries.setUnitCalendarImportUrl(other.id, unit.id, 'https://www.airbnb.com/x.ics')).toBeNull();
  });

  it('imports channel bookings, replacing previous blocks on each sync', async () => {
    const { org, unit } = await seedUnit();
    await queries.createUnitCalendar(org.id, unit.id);
    const calendar = await queries.setUnitCalendarImportUrl(org.id, unit.id, 'https://www.airbnb.com/calendar/ical/1.ics');

    const fetchMock = stubFetch(FEED('first'));
    expect(await syncUnitCalendar(calendar!)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://www.airbnb.com/calendar/ical/1.ics', expect.objectContaining({ redirect: 'error' }));

    stubFetch(FEED('second'));
    expect(await syncUnitCalendar(calendar!)).toBe(true);

    const blocks = await queries.listUpcomingBlocks(org.id, unit.id, '2026-01-01');
    expect(blocks).toEqual([{ id: expect.any(String), startsOn: '2099-12-01', endsOn: '2099-12-05', summary: 'Reserved' }]);
    const after = await queries.getUnitCalendar(org.id, unit.id);
    expect(after?.lastSyncedAt).toBeInstanceOf(Date);
    expect(after?.lastSyncError).toBeNull();
  });

  it('stores the error and keeps old blocks when the channel fails', async () => {
    const { org, unit } = await seedUnit();
    await queries.createUnitCalendar(org.id, unit.id);
    const calendar = await queries.setUnitCalendarImportUrl(org.id, unit.id, 'https://www.airbnb.com/calendar/ical/2.ics');
    stubFetch(FEED('kept'));
    await syncUnitCalendar(calendar!);

    stubFetch('nope', 500);
    expect(await syncUnitCalendar(calendar!)).toBe(false);

    expect((await queries.getUnitCalendar(org.id, unit.id))?.lastSyncError).toContain('HTTP 500');
    expect(await queries.listUpcomingBlocks(org.id, unit.id, '2026-01-01')).toHaveLength(1);
  });

  it('sweeps only calendars with an import URL that are due', async () => {
    const { org, unit } = await seedUnit();
    await queries.createUnitCalendar(org.id, unit.id);
    await queries.setUnitCalendarImportUrl(org.id, unit.id, 'https://www.airbnb.com/calendar/ical/3.ics');
    const due = await queries.listDueCalendars(new Date(Date.now() - 3600_000), 50);
    expect(due.map((c) => c.unitId)).toContain(unit.id);
    expect(due.every((c) => c.importUrl)).toBe(true);

    stubFetch(FEED('sweep'));
    expect(await syncDueUnitCalendars()).toBeGreaterThan(0);
    const again = await queries.listDueCalendars(new Date(Date.now() - 3600_000), 50);
    expect(again.map((c) => c.unitId)).not.toContain(unit.id);
  });

  it('exports active contracts as iCal through the public token route, without tenant data', async () => {
    const { org, unit } = await seedUnit('Depa 202');
    await seedContract(org.id, unit.id, { startDate: '2099-01-01', endDate: '2099-06-30' });
    await seedContract(org.id, unit.id, { startDate: '2000-01-01', endDate: '2000-12-31' });
    await seedContract(org.id, unit.id, { startDate: '2099-08-01', endDate: '2099-09-30', status: 'terminated' });
    await queries.createUnitCalendar(org.id, unit.id);
    const { exportToken } = (await queries.getUnitCalendar(org.id, unit.id))!;

    const res = await GET(new NextRequest(`http://localhost/api/public/calendar/${exportToken}.ics`), { params: Promise.resolve({ token: `${exportToken}.ics` }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const ics = await res.text();
    expect(ics).toContain('X-WR-CALNAME:Depa 202');
    expect(ics).toContain('DTSTART;VALUE=DATE:20990101');
    expect(ics).toContain('DTEND;VALUE=DATE:20990701');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain('Tenant');
  });

  it('404s on unknown or malformed tokens', async () => {
    const unknown = 'a'.repeat(64);
    for (const token of [unknown, 'short', '../etc']) {
      const res = await GET(new NextRequest(`http://localhost/api/public/calendar/${token}`), { params: Promise.resolve({ token }) });
      expect(res.status).toBe(404);
    }
  });
});
