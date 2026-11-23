import { describe, it, expect } from 'vitest';
import { AmenitySchema, BookAmenitySchema } from '@/lib/schemas/amenity';

const BOOKING = {
  amenity_id: '00000000-0000-0000-0000-000000000001',
  booked_on: '2099-01-10',
  start_time: '10:00',
};

const AMENITY = {
  property_id: '00000000-0000-0000-0000-000000000002',
  name: 'Parrilla',
  open_time: '10:00',
  close_time: '14:00',
  slot_minutes: '60',
};

describe('BookAmenitySchema — guest count and comment', () => {
  it('treats empty form fields as absent', () => {
    const result = BookAmenitySchema.parse({ ...BOOKING, guest_count: '', comment: '   ' });
    expect(result.guest_count).toBeUndefined();
    expect(result.comment).toBeUndefined();
  });

  it('coerces guest count and trims the comment', () => {
    const result = BookAmenitySchema.parse({ ...BOOKING, guest_count: '12', comment: '  Cumpleaños  ' });
    expect(result.guest_count).toBe(12);
    expect(result.comment).toBe('Cumpleaños');
  });

  it.each(['0', '501', '2.5', '-3', 'abc'])('rejects guest count %s', (guestCount) => {
    expect(BookAmenitySchema.safeParse({ ...BOOKING, guest_count: guestCount }).success).toBe(false);
  });

  it('accepts the 1 and 500 boundaries', () => {
    expect(BookAmenitySchema.safeParse({ ...BOOKING, guest_count: '1' }).success).toBe(true);
    expect(BookAmenitySchema.safeParse({ ...BOOKING, guest_count: '500' }).success).toBe(true);
  });

  it('rejects comments longer than 500 characters', () => {
    expect(BookAmenitySchema.safeParse({ ...BOOKING, comment: 'a'.repeat(500) }).success).toBe(true);
    expect(BookAmenitySchema.safeParse({ ...BOOKING, comment: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('AmenitySchema — capacity', () => {
  it('is optional', () => {
    expect(AmenitySchema.parse({ ...AMENITY, capacity: '' }).capacity).toBeUndefined();
    expect(AmenitySchema.parse(AMENITY).capacity).toBeUndefined();
  });

  it('accepts positive integers', () => {
    expect(AmenitySchema.parse({ ...AMENITY, capacity: '30' }).capacity).toBe(30);
  });

  it.each(['0', '-1', '1.5', '501'])('rejects capacity %s', (capacity) => {
    expect(AmenitySchema.safeParse({ ...AMENITY, capacity }).success).toBe(false);
  });
});
