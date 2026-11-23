export type Slot = { start: string; end: string };

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const toTime = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

export function daySlots(openTime: string, closeTime: string, slotMinutes: number): Slot[] {
  const close = toMinutes(closeTime);
  const slots: Slot[] = [];
  for (let start = toMinutes(openTime); start + slotMinutes <= close; start += slotMinutes) {
    slots.push({ start: toTime(start), end: toTime(start + slotMinutes) });
  }
  return slots;
}

export function findSlot(slots: Slot[], startTime: string): Slot | undefined {
  return slots.find((slot) => slot.start === startTime);
}

export function slotGrid<B extends { startTime: string }>(slots: Slot[], bookings: B[]) {
  const byStart = new Map(bookings.map((booking) => [booking.startTime, booking]));
  return slots.map((slot) => ({ ...slot, booking: byStart.get(slot.start) ?? null }));
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
