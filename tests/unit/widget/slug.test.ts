import { describe, it, expect } from 'vitest';
import { buildListingSlug } from '@/lib/widget/slug';

const ID = 'abcdef12-3456-7890-abcd-ef1234567890';

describe('widget/slug', () => {
  it('lowercases, strips accents and dashes non-alnum runs', () => {
    expect(buildListingSlug('Depa Frente al Parque – San Isidro', ID)).toBe('depa-frente-al-parque-san-isidro-abcdef');
  });

  it('translates es/pt accented letters', () => {
    expect(buildListingSlug('Ñandú São Paulo Café', ID)).toBe('nandu-sao-paulo-cafe-abcdef');
  });

  it('falls back to "propiedad" for an empty/unusable title', () => {
    expect(buildListingSlug('', ID)).toBe('propiedad-abcdef');
    expect(buildListingSlug(null, ID)).toBe('propiedad-abcdef');
    expect(buildListingSlug('***', ID)).toBe('propiedad-abcdef');
  });

  it('always appends the first 6 chars of the id (dashes stripped)', () => {
    const a = buildListingSlug('Depa', '11111111-2222-3333-4444-555555555555');
    const b = buildListingSlug('Depa', '99999999-2222-3333-4444-555555555555');
    expect(a).toBe('depa-111111');
    expect(b).toBe('depa-999999');
    expect(a).not.toBe(b);
  });

  it('truncates the base to 60 chars before appending the suffix', () => {
    const longTitle = 'a'.repeat(100);
    const slug = buildListingSlug(longTitle, ID);
    expect(slug).toBe(`${'a'.repeat(60)}-abcdef`);
  });
});
