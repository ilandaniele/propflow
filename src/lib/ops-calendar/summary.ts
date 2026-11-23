import type { CalendarEvent } from './events';

export function eventSubject(event: CalendarEvent): string {
  return [event.label, event.detail].filter(Boolean).join(' · ');
}

export function summarizeEvent(event: CalendarEvent, kindTitle: (event: CalendarEvent) => string): string {
  const subject = eventSubject(event);
  return subject ? `${kindTitle(event)}: ${subject}` : kindTitle(event);
}
