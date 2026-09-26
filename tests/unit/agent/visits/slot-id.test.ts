import { describe, it, expect } from 'vitest';
import { encodeSlotId, decodeSlotId, type SlotClaim } from '@/lib/agent/visits/slot-id';

const bind = { orgId: '11111111-1111-1111-1111-111111111111', sessionId: '22222222-2222-2222-2222-222222222222' };

function claim(overrides: Partial<SlotClaim> = {}): SlotClaim {
  return {
    profileId: '33333333-3333-3333-3333-333333333333',
    listingId: '44444444-4444-4444-4444-444444444444',
    startsAt: new Date('2026-10-05T14:00:00.000Z'),
    visitMinutes: 45,
    ...overrides,
  };
}

describe('agent/visits/slot-id', () => {
  it('round-trips a claim', () => {
    const c = claim();
    const id = encodeSlotId(c, bind);
    const decoded = decodeSlotId(id, bind);
    expect(decoded).not.toBeNull();
    expect(decoded?.profileId).toBe(c.profileId);
    expect(decoded?.listingId).toBe(c.listingId);
    expect(decoded?.visitMinutes).toBe(c.visitMinutes);
    expect(decoded?.startsAt.getTime()).toBe(Math.floor(c.startsAt.getTime() / 60_000) * 60_000);
  });

  it('round-trips a null listingId', () => {
    const c = claim({ listingId: null });
    const id = encodeSlotId(c, bind);
    const decoded = decodeSlotId(id, bind);
    expect(decoded?.listingId).toBeNull();
  });

  it('stays within a reasonable length for a Meta list row id', () => {
    // 42-byte payload (incl. the 4-byte issuedAt TTL field) + 12-byte HMAC,
    // base64url-encoded plus the 'sl_' prefix — well under Meta's 256-char row id limit.
    const id = encodeSlotId(claim(), bind);
    expect(id.length).toBeLessThanOrEqual(80);
  });

  it('returns null when a byte is altered', () => {
    const id = encodeSlotId(claim(), bind);
    const tampered = id.slice(0, -2) + (id.at(-2) === 'A' ? 'B' : 'A') + id.at(-1);
    expect(decodeSlotId(tampered, bind)).toBeNull();
  });

  it('returns null for a different sessionId', () => {
    const id = encodeSlotId(claim(), bind);
    expect(decodeSlotId(id, { ...bind, sessionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toBeNull();
  });

  it('returns null for a different orgId', () => {
    const id = encodeSlotId(claim(), bind);
    expect(decodeSlotId(id, { ...bind, orgId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(decodeSlotId('not-a-slot-id', bind)).toBeNull();
    expect(decodeSlotId('sl_not-base64!!!', bind)).toBeNull();
    expect(decodeSlotId('', bind)).toBeNull();
  });

  it('decodes an id issued just under 24h ago', () => {
    const issuedAt = new Date(Date.now() - (24 * 60 * 60 * 1000 - 60_000));
    const id = encodeSlotId(claim(), bind, issuedAt);
    expect(decodeSlotId(id, bind)).not.toBeNull();
  });

  it('rejects an id issued more than 24h ago (expired TTL)', () => {
    const issuedAt = new Date(Date.now() - (24 * 60 * 60 * 1000 + 60_000));
    const id = encodeSlotId(claim(), bind, issuedAt);
    expect(decodeSlotId(id, bind)).toBeNull();
  });
});
