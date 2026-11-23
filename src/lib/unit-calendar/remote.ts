const ALLOWED_HOSTS = [
  /(^|\.)airbnb\.[a-z]{2,3}(\.[a-z]{2})?$/,
  /(^|\.)booking\.com$/,
  /(^|\.)vrbo\.com$/,
];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

/** Only https calendar exports of the supported channels: the URL is fetched server-side, so no arbitrary hosts. */
export function isAllowedCalendarUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && ALLOWED_HOSTS.some((host) => host.test(url.hostname));
}

export async function fetchRemoteCalendar(url: string): Promise<string> {
  if (!isAllowedCalendarUrl(url)) throw new Error('Calendar URL not allowed');
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'text/calendar' },
  });
  if (!response.ok) throw new Error(`Calendar fetch failed with HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Calendar too large');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('Calendar too large');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not an iCalendar feed');
  return text;
}
