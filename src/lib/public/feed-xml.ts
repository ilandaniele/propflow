import type { PublicFeedListing } from './catalog';

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

const OPERATION_TYPE = { rent: 'For Rent', sale: 'For Sale' } as const;

const tag = (name: string, value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? '' : `<${name}>${escapeXml(String(value))}</${name}>`;

const formatDate = (date: Date) => date.toISOString().slice(0, 10).split('-').reverse().join('/');

type FeedOptions = { origin: string; orgSlug: string; orgName: string };

function adXml(listing: PublicFeedListing, { origin, orgSlug, orgName }: FeedOptions): string {
  const fields = [
    tag('id', listing.refCode ?? listing.slug),
    tag('url', `${origin}/p/${orgSlug}/${listing.slug}`),
    tag('title', listing.title ?? listing.slug),
    tag('type', OPERATION_TYPE[listing.operation]),
    tag('agency', orgName),
    tag('content', listing.description),
    listing.price === null ? '' : `<price currency="${escapeXml(listing.currency)}">${escapeXml(listing.price)}</price>`,
    tag('city_area', listing.zone),
    tag('country', 'PE'),
    tag('rooms', listing.bedrooms),
    tag('bathrooms', listing.bathrooms),
    tag('floor_area', listing.areaM2),
    listing.coverImageUrl ? `<pictures><picture><picture_url>${escapeXml(`${origin}${listing.coverImageUrl}`)}</picture_url></picture></pictures>` : '',
    tag('date', listing.publishedAt ? formatDate(listing.publishedAt) : null),
  ];
  return `<ad>${fields.join('')}</ad>`;
}

/** Trovit-format listings feed, the open XML schema that Peruvian portal integrators ingest. */
export function toPortalFeedXml(listings: PublicFeedListing[], options: FeedOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<trovit>${listings.map((l) => adXml(l, options)).join('\n')}</trovit>\n`;
}
