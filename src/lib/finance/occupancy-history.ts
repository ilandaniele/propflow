export type OccupancyUnit = { id: string; propertyId: string; propertyName: string | null };
export type OccupancyStay = { unitId: string; start: string; end: string | null };

export type MonthOccupancy = { month: string; occupiedDays: number; availableDays: number; rate: number | null };
export type PropertyOccupancy = { propertyId: string; propertyName: string | null; units: number; rates: Array<number | null>; average: number | null };

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const ratio = (occupied: number, available: number) => (available > 0 ? Math.round((occupied / available) * 1000) / 1000 : null);

function monthWindows(year: number, today: string) {
  const lastDay = dayNumber(today) + 1;
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const from = Date.UTC(year, index, 1) / DAY_MS;
    const to = Math.min(Date.UTC(year, index + 1, 1) / DAY_MS, lastDay);
    return { month, from, to: Math.max(from, to) };
  });
}

function occupiedDays(stays: Array<[number, number]>, from: number, to: number) {
  const clipped = stays
    .map(([start, end]) => [Math.max(start, from), Math.min(end, to)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = from;
  for (const [start, end] of clipped) {
    const begin = Math.max(start, cursor);
    if (end > begin) {
      total += end - begin;
      cursor = end;
    }
  }
  return total;
}

export function buildOccupancyHistory({ units, stays, year, today }: { units: OccupancyUnit[]; stays: OccupancyStay[]; year: number; today: string }) {
  const windows = monthWindows(year, today);
  const staysByUnit = new Map<string, Array<[number, number]>>();
  for (const stay of stays) {
    const list = staysByUnit.get(stay.unitId) ?? [];
    list.push([dayNumber(stay.start), stay.end ? dayNumber(stay.end) + 1 : Infinity]);
    staysByUnit.set(stay.unitId, list);
  }

  const byProperty = new Map<string, { propertyName: string | null; units: number; occupied: number[]; available: number[] }>();
  for (const unit of units) {
    const property = byProperty.get(unit.propertyId) ?? { propertyName: unit.propertyName, units: 0, occupied: windows.map(() => 0), available: windows.map(() => 0) };
    property.units += 1;
    windows.forEach(({ from, to }, index) => {
      property.occupied[index] += occupiedDays(staysByUnit.get(unit.id) ?? [], from, to);
      property.available[index] += to - from;
    });
    byProperty.set(unit.propertyId, property);
  }

  const properties: PropertyOccupancy[] = [...byProperty.entries()]
    .map(([propertyId, property]) => {
      const occupied = property.occupied.reduce((sum, value) => sum + value, 0);
      const available = property.available.reduce((sum, value) => sum + value, 0);
      return {
        propertyId,
        propertyName: property.propertyName,
        units: property.units,
        rates: property.occupied.map((value, index) => ratio(value, property.available[index])),
        average: ratio(occupied, available),
      };
    })
    .sort((a, b) => (a.propertyName ?? '').localeCompare(b.propertyName ?? ''));

  const months: MonthOccupancy[] = windows.map(({ month }, index) => {
    let occupied = 0;
    let available = 0;
    for (const property of byProperty.values()) {
      occupied += property.occupied[index];
      available += property.available[index];
    }
    return { month, occupiedDays: occupied, availableDays: available, rate: ratio(occupied, available) };
  });

  return { months, properties };
}
