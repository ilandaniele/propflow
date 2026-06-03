/**
 * tests/unit/airtable/normalize.test.ts
 *
 * AC6: normalizeRoom(record) maps AirtableRecord to internal Room entity.
 * Missing required fields raise a ZodError with field path.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { normalizeRoom, normalizeRooms, ROOM_FIELD } from '@/lib/airtable/normalize';
import { RoomSchema } from '@/lib/schemas/airtable';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<AirtableRecord['fields']> = {}): AirtableRecord {
  return {
    id: 'recABCD1234567890',
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      [ROOM_FIELD.NAME]: 'Habitación 101',
      [ROOM_FIELD.PROPERTY]: 'Casa Alameda',
      [ROOM_FIELD.MONTHLY_RENT]: 550,
      [ROOM_FIELD.STATUS]: 'Vacant',
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// normalizeRoom — happy path
// ---------------------------------------------------------------------------

describe('normalizeRoom — happy path (AC6)', () => {
  it('maps externalId to Airtable record id', () => {
    const room = normalizeRoom(makeRecord());
    expect(room.externalId).toBe('recABCD1234567890');
    expect(room.id).toBe('recABCD1234567890');
  });

  it('maps Name field to room.name', () => {
    const room = normalizeRoom(makeRecord());
    expect(room.name).toBe('Habitación 101');
  });

  it('maps Property field to room.propertyName', () => {
    const room = normalizeRoom(makeRecord());
    expect(room.propertyName).toBe('Casa Alameda');
  });

  it('maps Monthly Rent field to room.monthlyRent', () => {
    const room = normalizeRoom(makeRecord());
    expect(room.monthlyRent).toBe(550);
  });

  it('maps unitLabel to Name value', () => {
    const room = normalizeRoom(makeRecord());
    expect(room.unitLabel).toBe('Habitación 101');
  });

  it('normalises "Vacant" status to "vacant"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Vacant' }));
    expect(room.status).toBe('vacant');
  });

  it('normalises "Occupied" status to "occupied"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Occupied' }));
    expect(room.status).toBe('occupied');
  });

  it('normalises "Ocupado" (Spanish) to "occupied"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Ocupado' }));
    expect(room.status).toBe('occupied');
  });

  it('normalises "Vacío" (Spanish) to "vacant"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Vacío' }));
    expect(room.status).toBe('vacant');
  });

  it('normalises "Mantenimiento" (Spanish) to "maintenance"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Mantenimiento' }));
    expect(room.status).toBe('maintenance');
  });

  it('normalises "Maintenance" to "maintenance"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: 'Maintenance' }));
    expect(room.status).toBe('maintenance');
  });

  it('defaults missing status to "vacant"', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.STATUS]: undefined }));
    expect(room.status).toBe('vacant');
  });

  it('defaults missing Monthly Rent to 0', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.MONTHLY_RENT]: undefined }));
    expect(room.monthlyRent).toBe(0);
  });

  it('defaults missing Property to empty string', () => {
    const room = normalizeRoom(makeRecord({ [ROOM_FIELD.PROPERTY]: undefined }));
    expect(room.propertyName).toBe('');
  });

  it('returns a typed Room matching the RoomSchema', () => {
    const room = normalizeRoom(makeRecord());
    expect(() => RoomSchema.parse(room)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// normalizeRoom — validation errors (AC6: missing required fields → ZodError)
// ---------------------------------------------------------------------------

describe('normalizeRoom — ZodError on missing required fields (AC6)', () => {
  it('throws ZodError when Name field is missing', () => {
    const record = makeRecord({ [ROOM_FIELD.NAME]: undefined });
    expect(() => normalizeRoom(record)).toThrow(z.ZodError);
  });

  it('ZodError contains the correct field path (Name)', () => {
    const record = makeRecord({ [ROOM_FIELD.NAME]: undefined });
    try {
      normalizeRoom(record);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      const zodErr = e as z.ZodError;
      const fieldPaths = zodErr.issues.map(i => i.path.join('.'));
      expect(fieldPaths.some(p => p.includes('Name'))).toBe(true);
    }
  });

  it('throws ZodError when Name is an empty string', () => {
    const record = makeRecord({ [ROOM_FIELD.NAME]: '' });
    expect(() => normalizeRoom(record)).toThrow(z.ZodError);
  });

  it('throws ZodError when Monthly Rent is a non-numeric string', () => {
    const record = makeRecord({ [ROOM_FIELD.MONTHLY_RENT]: 'not-a-number' });
    expect(() => normalizeRoom(record)).toThrow(z.ZodError);
  });
});

// ---------------------------------------------------------------------------
// normalizeRooms — batch with partial failures
// ---------------------------------------------------------------------------

describe('normalizeRooms — batch normalisation', () => {
  it('normalises valid records and collects errors for invalid ones', () => {
    const valid = makeRecord();
    const invalid = makeRecord({ [ROOM_FIELD.NAME]: undefined });

    const { rooms, errors } = normalizeRooms([valid, invalid]);

    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe('recABCD1234567890');
    expect(errors).toHaveLength(1);
    expect(errors[0].recordId).toBe('recABCD1234567890');
  });

  it('returns all rooms when all records are valid', () => {
    const records = [
      makeRecord(),
      { ...makeRecord(), id: 'recXXXX2222222222', fields: { ...makeRecord().fields, [ROOM_FIELD.NAME]: 'Hab 2' } },
    ];
    const { rooms, errors } = normalizeRooms(records);
    expect(rooms).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it('returns empty rooms and all errors when all records are invalid', () => {
    const invalid1 = makeRecord({ [ROOM_FIELD.NAME]: undefined });
    const invalid2 = { ...makeRecord(), id: 'recINVALID222', fields: { [ROOM_FIELD.NAME]: undefined } };
    const { rooms, errors } = normalizeRooms([invalid1, invalid2]);
    expect(rooms).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });

  it('returns empty rooms and no errors for empty input', () => {
    const { rooms, errors } = normalizeRooms([]);
    expect(rooms).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
