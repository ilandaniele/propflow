/**
 * Opaque, HMAC-signed slot ids — the model never sees a raw profileId or a
 * bare timestamp, and can't fabricate one it wasn't handed by
 * get_available_slots in this exact conversation (bound to orgId+sessionId).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SlotClaim {
  profileId: string;
  listingId: string | null;
  startsAt: Date;
  visitMinutes: number;
}

interface SlotIdBinding {
  orgId: string;
  sessionId: string;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MAC_LEN = 12;
const PAYLOAD_LEN = 42; // uuid(16) + uuid(16) + uint32(4) startsAt-minutes + uint16(2) visitMinutes + uint32(4) issuedAt-minutes
const TTL_MS = 24 * 60 * 60 * 1000;

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) throw new Error('[agent/visits/slot-id] invalid uuid');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('[agent/visits/slot-id] AUTH_SECRET is required to encode/decode slot ids');
  return secret;
}

function packPayload(claim: SlotClaim, issuedAtMs: number): Buffer {
  const buf = Buffer.alloc(PAYLOAD_LEN);
  uuidToBytes(claim.profileId).copy(buf, 0);
  uuidToBytes(claim.listingId ?? NIL_UUID).copy(buf, 16);
  const minutesEpoch = Math.floor(claim.startsAt.getTime() / 60_000);
  buf.writeUInt32BE(minutesEpoch >>> 0, 32);
  buf.writeUInt16BE(claim.visitMinutes & 0xffff, 36);
  buf.writeUInt32BE(Math.floor(issuedAtMs / 60_000) >>> 0, 38);
  return buf;
}

function computeMac(orgId: string, sessionId: string, payload: Buffer): Buffer {
  const h = createHmac('sha256', authSecret());
  h.update(orgId);
  h.update('|');
  h.update(sessionId);
  h.update('|');
  h.update(payload);
  return h.digest().subarray(0, MAC_LEN);
}

/** 'sl_' + base64url(payload || truncated-hmac). Throws if AUTH_SECRET is unset. `issuedAt` defaults to now — a slot id is only valid for TTL_MS (24h) after it was minted, regardless of when the offered slot itself starts. */
export function encodeSlotId(claim: SlotClaim, bind: SlotIdBinding, issuedAt: Date = new Date()): string {
  const payload = packPayload(claim, issuedAt.getTime());
  const signature = computeMac(bind.orgId, bind.sessionId, payload);
  return `sl_${Buffer.concat([payload, signature]).toString('base64url')}`;
}

/**
 * Returns null if the id was altered, doesn't bind to this orgId/sessionId,
 * is malformed, or was issued more than TTL_MS (24h) ago. Throws if
 * AUTH_SECRET is unset (a config error, not a user-input error).
 */
export function decodeSlotId(id: string, bind: SlotIdBinding): SlotClaim | null {
  if (typeof id !== 'string' || !id.startsWith('sl_')) return null;

  let full: Buffer;
  try {
    full = Buffer.from(id.slice(3), 'base64url');
  } catch {
    return null;
  }
  if (full.length !== PAYLOAD_LEN + MAC_LEN) return null;

  const payload = full.subarray(0, PAYLOAD_LEN);
  const signature = full.subarray(PAYLOAD_LEN);
  const expected = computeMac(bind.orgId, bind.sessionId, payload);

  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) return null;

  try {
    const profileId = bytesToUuid(payload.subarray(0, 16));
    const listingIdRaw = bytesToUuid(payload.subarray(16, 32));
    const minutesEpoch = payload.readUInt32BE(32);
    const visitMinutes = payload.readUInt16BE(36);
    const issuedAtMinutesEpoch = payload.readUInt32BE(38);
    const issuedAtMs = issuedAtMinutesEpoch * 60_000;
    if (Date.now() - issuedAtMs > TTL_MS) return null;
    return {
      profileId,
      listingId: listingIdRaw === NIL_UUID ? null : listingIdRaw,
      startsAt: new Date(minutesEpoch * 60_000),
      visitMinutes,
    };
  } catch {
    return null;
  }
}
