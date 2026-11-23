import { describe, it, expect } from 'vitest';
import { escapeXml, toPortalFeedXml } from '@/lib/public/feed-xml';
import type { PublicFeedListing } from '@/lib/public/catalog';

const OPTIONS = { origin: 'https://app.example.com', orgSlug: 'acme', orgName: 'Acme & Co' };

function listing(overrides: Partial<PublicFeedListing> = {}): PublicFeedListing {
  return {
    slug: 'depa-miraflores',
    title: 'Depa <Miraflores>',
    operation: 'rent',
    price: '1500',
    currency: 'PEN',
    zone: 'Miraflores',
    bedrooms: 2,
    bathrooms: 1,
    areaM2: '70',
    coverImageUrl: '/api/public/listing-image/abc',
    description: 'Luminoso "vista al mar"',
    refCode: 'REF-1',
    publishedAt: new Date('2026-03-05T12:00:00Z'),
    ...overrides,
  } as PublicFeedListing;
}

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });
});

describe('toPortalFeedXml', () => {
  it('renders a Trovit ad with escaped fields, absolute urls and dd/mm/yyyy date', () => {
    const xml = toPortalFeedXml([listing()], OPTIONS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<trovit><ad>');
    expect(xml).toContain('<id>REF-1</id>');
    expect(xml).toContain('<url>https://app.example.com/p/acme/depa-miraflores</url>');
    expect(xml).toContain('<title>Depa &lt;Miraflores&gt;</title>');
    expect(xml).toContain('<type>For Rent</type>');
    expect(xml).toContain('<agency>Acme &amp; Co</agency>');
    expect(xml).toContain('<content>Luminoso &quot;vista al mar&quot;</content>');
    expect(xml).toContain('<price currency="PEN">1500</price>');
    expect(xml).toContain('<picture_url>https://app.example.com/api/public/listing-image/abc</picture_url>');
    expect(xml).toContain('<date>05/03/2026</date>');
  });

  it('maps sale operation and falls back to slug for id and title', () => {
    const xml = toPortalFeedXml([listing({ operation: 'sale', refCode: null, title: null })], OPTIONS);
    expect(xml).toContain('<type>For Sale</type>');
    expect(xml).toContain('<id>depa-miraflores</id>');
    expect(xml).toContain('<title>depa-miraflores</title>');
  });

  it('omits empty optional fields', () => {
    const xml = toPortalFeedXml(
      [listing({ price: null, description: null, zone: null, coverImageUrl: null, publishedAt: null, bedrooms: null })],
      OPTIONS,
    );
    expect(xml).not.toContain('<price');
    expect(xml).not.toContain('<content>');
    expect(xml).not.toContain('<city_area>');
    expect(xml).not.toContain('<pictures>');
    expect(xml).not.toContain('<date>');
    expect(xml).not.toContain('<rooms>');
  });

  it('renders an empty feed', () => {
    expect(toPortalFeedXml([], OPTIONS)).toContain('<trovit></trovit>');
  });
});
