/**
 * Public listing slugs (src/app/p/[orgSlug]/[listingSlug]) — pure, no DB
 * access. Byte-identical to the backfill in the old Postgres migration
 * src/lib/db/migrations/0009_agent_web.sql (kept at git tag
 * archive/fly-postgres; D1 inherited the backfilled slugs), so a listing
 * minted by syncListingsFromUnits() (this function) and one backfilled by
 * the migration always agree.
 *
 * Not a general Unicode fold: only the accented Latin letters common in
 * es/pt titles are translated (matches the migration's SQL TRANSLATE()
 * table char-for-char). Do not change the map: existing slugs depend on it.
 */

const ACCENT_MAP: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ñ: 'n', ç: 'c',
};

const ACCENT_RE = /[áàâãäåéèêëíìîïóòôõöúùûüñç]/g;

/** Empty/unusable title -> base 'propiedad'. Always suffixed with 6 chars of the id so two listings never collide. */
export function buildListingSlug(title: string | null, id: string): string {
  const lowered = (title ?? '').toLowerCase();
  const translated = lowered.replace(ACCENT_RE, (c) => ACCENT_MAP[c] ?? c);
  const base = translated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const suffix = id.replace(/-/g, '').slice(0, 6);
  return `${base || 'propiedad'}-${suffix}`;
}
