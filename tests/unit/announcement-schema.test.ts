import { describe, it, expect } from 'vitest';
import { AnnouncementSchema, PinAnnouncementSchema } from '@/lib/schemas/ops';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
const UNIT = '22222222-2222-4222-8222-222222222222';
const base = { title: 'Water cut', body: 'Tomorrow 9 to 12.' };

describe('AnnouncementSchema', () => {
  it('defaults flags to false and audience to all', () => {
    const parsed = AnnouncementSchema.parse(base);
    expect(parsed).toMatchObject({ audience: 'all', pinned: false, important: false, property_id: undefined, unit_id: undefined });
  });

  it('reads checkbox values as true', () => {
    expect(AnnouncementSchema.parse({ ...base, pinned: 'on', important: 'on' })).toMatchObject({ pinned: true, important: true });
  });

  it('requires a property when the audience is a property', () => {
    expect(AnnouncementSchema.safeParse({ ...base, audience: 'property' }).success).toBe(false);
    expect(AnnouncementSchema.safeParse({ ...base, audience: 'property', property_id: '' }).success).toBe(false);
    expect(AnnouncementSchema.parse({ ...base, audience: 'property', property_id: PROPERTY }).property_id).toBe(PROPERTY);
  });

  it('requires a unit when the audience is a unit', () => {
    expect(AnnouncementSchema.safeParse({ ...base, audience: 'unit', property_id: PROPERTY }).success).toBe(false);
    expect(AnnouncementSchema.parse({ ...base, audience: 'unit', unit_id: UNIT }).unit_id).toBe(UNIT);
  });

  it('drops targets that do not match the audience', () => {
    const parsed = AnnouncementSchema.parse({ ...base, audience: 'all', property_id: PROPERTY, unit_id: UNIT });
    expect(parsed).toMatchObject({ property_id: undefined, unit_id: undefined });
  });

  it('rejects non-uuid targets', () => {
    expect(AnnouncementSchema.safeParse({ ...base, audience: 'unit', unit_id: 'abc' }).success).toBe(false);
  });
});

describe('PinAnnouncementSchema', () => {
  it('parses the pinned flag from strings', () => {
    expect(PinAnnouncementSchema.parse({ id: UNIT, pinned: 'true' }).pinned).toBe(true);
    expect(PinAnnouncementSchema.parse({ id: UNIT, pinned: 'false' }).pinned).toBe(false);
    expect(PinAnnouncementSchema.safeParse({ id: UNIT, pinned: 'yes' }).success).toBe(false);
  });
});
