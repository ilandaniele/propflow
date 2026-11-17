/**
 * Password hashing built on WebCrypto PBKDF2 only (no native deps, no bcrypt cost
 * 12 in the hot path) so it also runs inside Cloudflare Workers' CPU budget.
 *
 * Stored format (self-describing, iterations travel with the hash so they can be
 * raised later without breaking old rows):
 *
 *   pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>
 *
 * Legacy bcrypt hashes (`$2a$` / `$2b$` / `$2y$`) are verified with bcryptjs only
 * when LEGACY_BCRYPT_VERIFY=1, and always report `needsRehash: true` so callers
 * can transparently upgrade the stored value after a successful login. bcryptjs
 * is imported lazily so it can be dropped from a Worker bundle.
 */

const SCHEME = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const KEY_BITS = 256;
const DEFAULT_ITERATIONS = 100_000;
const MIN_CONFIGURED_ITERATIONS = 10_000;
// Upper bound on iterations accepted from a stored hash — guards against a
// tampered row turning every login into a CPU burn.
const MAX_STORED_ITERATIONS = 10_000_000;

// Fixed salt for dummyVerify — the derived value is discarded, only the work matters.
const DUMMY_SALT = new Uint8Array(SALT_BYTES).fill(0x5a);

function resolveIterations(): number {
  const raw = process.env.PBKDF2_ITERATIONS?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (Number.isSafeInteger(n) && n >= MIN_CONFIGURED_ITERATIONS) return n;
  }
  return DEFAULT_ITERATIONS;
}

/** Iterations used for newly created hashes; stored hashes below this get rehashed. */
export const PBKDF2_ITERATIONS: number = resolveIterations();

export type VerifyResult =
  | { ok: true; needsRehash: boolean }
  | { ok: false; reason: 'mismatch' | 'legacy_unsupported' };

const LEGACY_BCRYPT_PREFIX = /^\$2[aby]\$/;

export function isLegacyHash(stored: string): boolean {
  return typeof stored === 'string' && LEGACY_BCRYPT_PREFIX.test(stored);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Compares two byte arrays without an early return on the first differing byte. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(plain, salt, PBKDF2_ITERATIONS);
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Does the same PBKDF2 work as a real verification so the login path takes
 * equivalent time when the email doesn't exist. Computed on demand, not at
 * module load.
 */
export async function dummyVerify(plain: string): Promise<void> {
  await derive(plain, DUMMY_SALT, PBKDF2_ITERATIONS);
}

async function verifyLegacy(plain: string, stored: string): Promise<VerifyResult> {
  if (process.env.LEGACY_BCRYPT_VERIFY !== '1') {
    // Keep timing comparable to a real check; the outcome is fixed regardless.
    await dummyVerify(plain);
    return { ok: false, reason: 'legacy_unsupported' };
  }
  try {
    const { compare } = await import('bcryptjs');
    return (await compare(plain, stored))
      ? { ok: true, needsRehash: true }
      : { ok: false, reason: 'mismatch' };
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
}

/** Parses a stored PBKDF2 string; returns null when it is not well formed. */
function parseStored(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  if (!/^\d+$/.test(parts[1])) return null;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_STORED_ITERATIONS) return null;
  try {
    const salt = fromBase64(parts[2]);
    const hash = fromBase64(parts[3]);
    if (salt.length === 0 || hash.length === 0) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

export async function verifyPassword(plain: string, stored: string): Promise<VerifyResult> {
  try {
    if (typeof stored !== 'string' || stored.length === 0) {
      await dummyVerify(plain);
      return { ok: false, reason: 'mismatch' };
    }
    if (isLegacyHash(stored)) return await verifyLegacy(plain, stored);

    const parsed = parseStored(stored);
    if (!parsed) {
      await dummyVerify(plain);
      return { ok: false, reason: 'mismatch' };
    }
    const candidate = await derive(plain, parsed.salt, parsed.iterations);
    if (!constantTimeEqual(candidate, parsed.hash)) return { ok: false, reason: 'mismatch' };
    return { ok: true, needsRehash: parsed.iterations < PBKDF2_ITERATIONS };
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
}
