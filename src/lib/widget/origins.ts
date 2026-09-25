/**
 * Origin handling for the web widget's iframe/postMessage security model
 * (Phase 7 §2.2, §2.9). Pure — no DB access.
 */

/** The app's own origin — the widget iframe (src/app/widget/[publicKey]) is served from here. */
export function getAppOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL;
  if (!url) throw new Error('[widget/origins] NEXT_PUBLIC_SITE_URL or NEXTAUTH_URL is required');
  return new URL(url).origin;
}

/**
 * https only, except localhost/127.0.0.1 (dev). No path/query, lowercased
 * host, default port stripped. Returns null for anything that doesn't parse
 * or doesn't qualify — callers must drop, not throw, on bad input (this
 * validates admin-submitted allowed-origins).
 */
export function normalizeOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) return null;

  return url.origin.toLowerCase();
}

/** `"frame-ancestors 'self' https://a https://b"` — only valid normalized origins survive. */
export function buildFrameAncestors(origins: string[]): string {
  const valid = origins.map(normalizeOrigin).filter((o): o is string => o !== null);
  return ["frame-ancestors 'self'", ...valid].join(' ');
}

/** True when the request's Origin is this app's own origin, or (no Origin header — same-origin navigations don't always send one) Sec-Fetch-Site says so. */
export function isSameAppOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin) return origin === getAppOrigin();
  return req.headers.get('sec-fetch-site') === 'same-origin';
}
